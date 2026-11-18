import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express, { type RequestHandler } from "express";
import type { Pool } from "pg";
import { StorageError } from "../../src/integrations/object-storage/types.js";
import { PdfError, type PdfExtraction } from "../../src/integrations/pdf/types.js";
import { cleanFileName, createResumeRouter, toHttpError } from "../../src/modules/resumes/routes.js";
import { createResumeService } from "../../src/modules/resumes/service.js";
import {
  FakeCleanupRepository, FakeResumeRepository, FakeStorage, collectLogs, extraction, fakeExtractor, pdfBytes, pgError,
} from "../fakes/resumes.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// Stand-in for the real requireVerifiedUser: the test picks the user with a header.
const fakeAuth: RequestHandler = (req, res, next) => {
  const userId = req.get("x-test-user");
  if (!userId) return void res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign in first." } });
  res.locals.auth = { userId, sessionId: "test-session", emailVerified: true };
  next();
};

let baseUrl = "";
let current: ReturnType<typeof makeDeps>;
let close: () => void;

function makeDeps(result: PdfExtraction | PdfError = extraction()) {
  const cleanup = new FakeCleanupRepository();
  const resumes = new FakeResumeRepository(cleanup);
  const storage = new FakeStorage();
  const pdf = fakeExtractor(result);
  const logs = collectLogs();
  return { cleanup, resumes, storage, pdf, logs };
}

// One server for all tests; each test swaps in fresh fakes through `current`.
before(async () => {
  current = makeDeps();
  const app = express();
  const service = new Proxy({} as ReturnType<typeof createResumeService>, {
    get: (_target, key: keyof ReturnType<typeof createResumeService>) =>
      createResumeService({ pool: {} as Pool, ...current, log: current.logs.log })[key],
  });
  app.use("/api/v1/resumes", createResumeRouter({ service, authenticate: fakeAuth, log: (...args) => current.logs.log(...args) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/resumes`;
  close = () => { server.closeAllConnections(); server.close(); };
});
after(() => close());

function reset(result?: PdfExtraction | PdfError) {
  current = makeDeps(result);
  return current;
}

function form(fields: { name?: string; files?: { bytes: Buffer<ArrayBuffer>; fileName: string }[] }) {
  const body = new FormData();
  if (fields.name !== undefined) body.append("name", fields.name);
  for (const file of fields.files ?? [{ bytes: pdfBytes(), fileName: "cv.pdf" }]) {
    body.append("file", new Blob([file.bytes], { type: "application/pdf" }), file.fileName);
  }
  return body;
}

function call(path: string, init: RequestInit & { user?: string | null } = {}) {
  const { user = USER, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (user) headers.set("x-test-user", user);
  return fetch(`${baseUrl}${path}`, { ...rest, headers });
}

const upload = (fields: Parameters<typeof form>[0], user?: string | null) =>
  call("", { method: "POST", body: form(fields), user });

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

test("upload returns 201, a Location header and the public resume shape", async () => {
  reset();
  const response = await upload({ name: "  Backend resume  " });
  assert.equal(response.status, 201);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.headers.get("location"), `/api/v1/resumes/${body.id}`);
  assert.deepEqual(Object.keys(body).sort(), [
    "createdAt", "fileName", "id", "linkedApplicationCount", "mimeType", "name", "sizeBytes", "textStatus",
  ]);
  assert.equal(body.name, "Backend resume");
  assert.equal(body.textStatus, "available");
  assert.equal(body.sizeBytes, pdfBytes().byteLength);
  assert.equal(body.linkedApplicationCount, 0);

  reset(extraction("short"));
  assert.equal((await (await upload({ name: "Scan" })).json() as { textStatus: string }).textStatus, "unavailable");
});

test("no verified user: 401 and the 3 MiB body never reaches the parser or storage", async () => {
  const { pdf, storage } = reset();
  const response = await upload({ name: "x", files: [{ bytes: pdfBytes(3 * 1024 * 1024), fileName: "big.pdf" }] }, null);
  assert.equal(response.status, 401);
  assert.equal(pdf.calls, 0);
  assert.equal(storage.calls.length, 0);
});

test("upload input errors: 415, 400, 422 and 413", async () => {
  reset();
  const json = await call("", { method: "POST", body: JSON.stringify({ name: "x" }), headers: { "content-type": "application/json" } });
  assert.deepEqual([json.status, await errorCode(json)], [415, "UNSUPPORTED_MEDIA_TYPE"]);

  const noName = await upload({});
  assert.deepEqual([noName.status, await errorCode(noName)], [400, "BAD_REQUEST"]);

  const twoFiles = await upload({ name: "x", files: [
    { bytes: pdfBytes(), fileName: "a.pdf" }, { bytes: pdfBytes(), fileName: "b.pdf" },
  ] });
  assert.deepEqual([twoFiles.status, await errorCode(twoFiles)], [400, "BAD_REQUEST"]);

  // 1025 bytes is over multer's fieldSize; it must still be the same 422, not a 400.
  for (const name of ["   ", "x".repeat(201), "x".repeat(1025)]) {
    const invalid = await upload({ name });
    assert.deepEqual([invalid.status, await errorCode(invalid)], [422, "VALIDATION_ERROR"]);
  }
  assert.equal((await upload({ name: "中".repeat(200) })).status, 201, "200 characters is allowed");

  const big = await upload({ name: "x", files: [{ bytes: pdfBytes(2 * 1024 * 1024 + 1), fileName: "big.pdf" }] });
  assert.deepEqual([big.status, await errorCode(big)], [413, "PDF_TOO_LARGE"]);
  assert.equal(current.storage.calls.length, 1, "only the 200-character upload was stored");
});

test("PDF problems map to 422 and server-side problems to 503", async () => {
  for (const [code, status, apiCode] of [
    ["invalid_pdf", 422, "PDF_INVALID"],
    ["too_many_pages", 422, "PDF_TOO_MANY_PAGES"],
    ["unreadable_encryption", 422, "PDF_PASSWORD_PROTECTED"],
    ["timeout", 503, "PDF_PROCESSING_FAILED"],
    ["processing_failed", 503, "PDF_PROCESSING_FAILED"],
  ] as const) {
    reset(new PdfError(code));
    const response = await upload({ name: "x" });
    assert.deepEqual([response.status, await errorCode(response)], [status, apiCode], code);
  }
  reset(new PdfError("busy"));
  const busy = await upload({ name: "x" });
  assert.deepEqual([busy.status, busy.headers.get("retry-after"), await errorCode(busy)], [503, "5", "PDF_BUSY"]);
});

test("storage and database failures map to 503, bugs to 500 without leaking details", async () => {
  reset().storage.putError = new StorageError("access_denied");
  const storageDown = await upload({ name: "x" });
  assert.deepEqual([storageDown.status, await errorCode(storageDown)], [503, "SERVICE_UNAVAILABLE"]);
  assert.match(String(current.logs.entries.at(-1)?.details?.error), /access_denied/, "a 503 is logged too");

  reset().resumes.insertError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const dbDown = await upload({ name: "x" });
  assert.deepEqual([dbDown.status, await errorCode(dbDown)], [503, "SERVICE_UNAVAILABLE"]);

  const brokenPipe = reset();
  brokenPipe.resumes.insertError = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  brokenPipe.resumes.lookupError = brokenPipe.resumes.insertError;
  assert.equal((await upload({ name: "x" })).status, 503);

  const unknown = reset();
  unknown.resumes.insertError = new Error("Query read timeout");
  const timedOut = await upload({ name: "x" });
  assert.deepEqual([timedOut.status, await errorCode(timedOut)], [503, "SERVICE_UNAVAILABLE"]);

  reset().resumes.insertError = pgError("23505", "duplicate key value violates unique constraint");
  const bug = await upload({ name: "x" });
  const body = await bug.json() as { error: { code: string; message: string } };
  assert.equal(bug.status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.doesNotMatch(body.error.message, /duplicate/);
  assert.match(String(current.logs.entries.at(-1)?.details?.error), /duplicate key/);
});

test("cancelled work gets no answer", () => {
  assert.equal(toHttpError(new PdfError("cancelled")), null);
  assert.equal(toHttpError(new StorageError("cancelled")), null);
});

test("list, get and delete: owner only, 404 for others and for non-UUID ids", async () => {
  const { resumes, storage } = reset();
  const mine = resumes.seed({ id: "e0000000-0000-4000-8000-000000000001", userId: USER, objectKey: "resumes/m.pdf", linkedApplicationCount: 2 });
  resumes.seed({ id: "e0000000-0000-4000-8000-000000000002", userId: OTHER, objectKey: "resumes/o.pdf" });

  const list = await (await call("")).json() as { data: { id: string; linkedApplicationCount: number }[] };
  assert.deepEqual(list.data.map((r) => [r.id, r.linkedApplicationCount]), [[mine.id, 2]]);
  assert.equal((await call(`/${mine.id}`)).status, 200);
  assert.equal((await call(`/${mine.id}`, { user: OTHER })).status, 404);

  for (const path of ["/not-a-uuid", "/not-a-uuid/file"]) assert.equal((await call(path)).status, 404);
  assert.equal((await call("/not-a-uuid", { method: "DELETE" })).status, 404);

  assert.equal((await call(`/${mine.id}`, { method: "DELETE", user: OTHER })).status, 404);
  const deleted = await call(`/${mine.id}`, { method: "DELETE" });
  assert.deepEqual(await deleted.json(), { unlinkedApplicationCount: 2 });
  assert.equal((await call(`/${mine.id}`, { method: "DELETE" })).status, 404, "a retried DELETE is 404");
  assert.equal((await call(`/${mine.id}`)).status, 404);
  assert.equal(storage.calls.length, 0, "R2 is cleaned up by the worker, not the request");
});

test("download sends private PDF headers and keeps a non-ASCII file name", async () => {
  reset();
  const created = await (await upload({ name: "CV", files: [{ bytes: pdfBytes(), fileName: "简历 Résumé.pdf" }] })).json() as { id: string; fileName: string };
  assert.equal(created.fileName, "简历 Résumé.pdf");

  const response = await call(`/${created.id}/file`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment; .*filename\*=UTF-8''%E7%AE%80%E5%8E%86%20R%C3%A9sum%C3%A9\.pdf$/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(pdfBytes()));
  assert.equal((await call(`/${created.id}/file`, { user: OTHER })).status, 404);
});

test("file names lose paths and control characters and are capped at 255 characters", () => {
  assert.equal(cleanFileName("C:\\Users\\me\\cv.pdf"), "cv.pdf");
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName("a\u0000b\nc.pdf"), "abc.pdf");
  assert.equal(cleanFileName(""), "resume.pdf");
  assert.equal(cleanFileName(undefined), "resume.pdf");
  assert.equal([...cleanFileName("中".repeat(300))].length, 255);
});
