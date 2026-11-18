import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { StorageError } from "../../integrations/object-storage/types.js";
import { PdfError, type PdfErrorCode } from "../../integrations/pdf/types.js";
import { ServiceUnavailableError, UNAVAILABLE_MESSAGE, isDbUnavailable } from "./errors.js";
import { MAX_RESUME_BYTES } from "./pdf-policy.js";
import type { ResumeRow } from "./repository.js";
import { defaultLog, type Log, type ResumeService } from "./service.js";

// /api/v1/resumes (endpoints.json "Resumes"). Mount with the verified-user middleware:
//   app.use("/api/v1/resumes", createResumeRouter({ service, authenticate: requireVerifiedUser }))

export interface ResumeRouterOptions {
  service: ResumeService;
  /** Must reject unauthenticated or unverified users and set res.locals.auth.userId. */
  authenticate: RequestHandler;
  log?: Log;
}

/** A request problem with a fixed HTTP answer. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_CHARS = 200;
const MAX_FILE_NAME_CHARS = 255;

const parseUpload = multer({
  storage: multer.memoryStorage(),
  // One small text field (name) and one file; anything else is a bad request. 1 KiB holds a
  // 200-character name in any script (at most 4 bytes per character).
  limits: { fileSize: MAX_RESUME_BYTES, files: 1, fields: 1, fieldSize: 1024, parts: 2 },
  defParamCharset: "utf8", // keep non-ASCII file names (multer's default is latin1)
}).single("file");

export function createResumeRouter({ service, authenticate, log = defaultLog }: ResumeRouterOptions): Router {
  const router = Router();
  // Before any body parsing: a request without a verified user is never read.
  router.use(authenticate);

  router.get("/", async (_req, res) => {
    const rows = await service.list(userIdOf(res));
    res.json({ data: rows.map(toPublicResume) });
  });

  router.post("/", receiveUpload, async (req, res) => {
    const { name, fileName, bytes } = uploadInput(req);
    const row = await service.upload({ userId: userIdOf(res), name, fileName, bytes, signal: requestSignal(res) });
    res.status(201).location(`${req.baseUrl}/${row.id}`).json(toPublicResume(row));
  });

  router.get("/:resumeId", async (req, res) => {
    const id = resumeIdOf(req);
    const row = id && (await service.get(userIdOf(res), id));
    if (!row) return sendNotFound(res);
    res.json(toPublicResume(row));
  });

  router.get("/:resumeId/file", async (req, res) => {
    const id = resumeIdOf(req);
    const file = id && (await service.download(userIdOf(res), id, requestSignal(res)));
    if (!file) return sendNotFound(res);
    res.attachment(file.resume.originalFilename); // RFC 6266 encoding for non-ASCII names
    res.set({
      "Content-Type": "application/pdf", // after attachment(), which guesses from the extension
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(file.bytes);
  });

  router.delete("/:resumeId", async (req, res) => {
    const id = resumeIdOf(req);
    const result = id && (await service.remove(userIdOf(res), id));
    if (!result) return sendNotFound(res);
    res.json(result);
  });

  // Express 5 forwards errors from async handlers here.
  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const answer = toHttpError(error);
    if (!answer) return; // cancelled: the client has gone, there is no one to answer
    // Every server-side failure except PDF_BUSY (expected under load), so a 503 caused by bad R2
    // credentials or an unreachable database shows up in the log. Errors never carry file bytes or text.
    if (answer.status >= 500 && answer.code !== "PDF_BUSY") {
      log("Resume request failed", { status: answer.status, code: answer.code, error: error instanceof Error ? error.stack : String(error) });
    }
    if (answer.code === "PDF_BUSY") res.set("Retry-After", "5");
    res.status(answer.status).json({ error: { code: answer.code, message: answer.message } });
  };
  router.use(handleError);
  return router;
}

const receiveUpload: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    return next(new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Upload the resume as multipart/form-data."));
  }
  parseUpload(req, res, (error?: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") return next(new PdfError("too_large"));
      // A name over fieldSize is just a name that is too long.
      if (error.code === "LIMIT_FIELD_VALUE" && error.field === "name") return next(invalidName());
    }
    next(badUpload());
  });
};

const badUpload = () => new HttpError(400, "BAD_REQUEST", "Send exactly one PDF in the file field and a name field.");
const invalidName = () => new HttpError(422, "VALIDATION_ERROR", `The resume name must be 1–${MAX_NAME_CHARS} characters.`);

function uploadInput(req: Request) {
  const rawName: unknown = req.body?.name;
  if (!req.file || typeof rawName !== "string") throw badUpload();
  const name = rawName.trim();
  if (!name || [...name].length > MAX_NAME_CHARS) throw invalidName();
  return { name, fileName: cleanFileName(req.file.originalname), bytes: req.file.buffer };
}

/** The browser's file name without any path or control characters, at most 255 characters. */
export function cleanFileName(raw: string | undefined): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = [...base.replace(/[\u0000-\u001f\u007f]/g, "").trim()].slice(0, MAX_FILE_NAME_CHARS).join("");
  return cleaned || "resume.pdf";
}

function userIdOf(res: Response): string {
  const userId: unknown = res.locals.auth?.userId;
  if (typeof userId !== "string" || !userId) throw new Error("Resume routes mounted without authentication");
  return userId;
}

// A non-UUID id can't exist, and would make PostgreSQL throw a cast error.
function resumeIdOf(req: Request): string | null {
  const id = req.params.resumeId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

function sendNotFound(res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Resume not found." } });
}

/** Aborted when the client disconnects before the response is finished. */
function requestSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function toPublicResume(row: ResumeRow) {
  return {
    id: row.id,
    name: row.name,
    fileName: row.originalFilename,
    mimeType: "application/pdf",
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    textStatus: row.parseStatus === "succeeded" ? "available" : "unavailable",
    linkedApplicationCount: row.linkedApplicationCount,
  };
}

const PDF_ERRORS: Record<Exclude<PdfErrorCode, "cancelled">, [status: number, code: string]> = {
  too_large: [413, "PDF_TOO_LARGE"],
  invalid_pdf: [422, "PDF_INVALID"],
  too_many_pages: [422, "PDF_TOO_MANY_PAGES"],
  unreadable_encryption: [422, "PDF_PASSWORD_PROTECTED"],
  busy: [503, "PDF_BUSY"],
  timeout: [503, "PDF_PROCESSING_FAILED"],
  processing_failed: [503, "PDF_PROCESSING_FAILED"],
};

/** HTTP answer for an error, or null when the request was cancelled by the client. */
export function toHttpError(error: unknown): { status: number; code: string; message: string } | null {
  if (error instanceof HttpError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof PdfError) {
    if (error.code === "cancelled") return null;
    const [status, code] = PDF_ERRORS[error.code];
    return { status, code, message: error.message };
  }
  if (error instanceof StorageError) {
    return error.code === "cancelled" ? null : { status: 503, code: "SERVICE_UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
  }
  if (error instanceof ServiceUnavailableError || isDbUnavailable(error)) {
    return { status: 503, code: "SERVICE_UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." };
}
