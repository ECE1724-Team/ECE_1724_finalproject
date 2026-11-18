import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createObjectKey } from "../../integrations/object-storage/r2.js";
import type { ObjectStorage } from "../../integrations/object-storage/types.js";
import type { PdfExtractor } from "../../integrations/pdf/types.js";
import { ServiceUnavailableError, isDefiniteDbFailure } from "./errors.js";
import { validateResumePdf, type ResumePdfResult } from "./pdf-policy.js";
import type { NewResumeRow, ResumeRepository, ResumeRow, StorageCleanupRepository } from "./repository.js";

export type Log = (message: string, details?: Record<string, unknown>) => void;

export interface ResumeServiceDeps {
  pool: Pool;
  storage: ObjectStorage;
  /** Create one extractor per process and share it; it holds the parse concurrency limit. */
  pdf: PdfExtractor;
  resumes: ResumeRepository;
  cleanup: StorageCleanupRepository;
  /** Never pass file bytes or extracted text to it. Defaults to console.error. */
  log?: Log;
}

export interface UploadInput {
  userId: string;
  /** Already trimmed and validated by the caller. */
  name: string;
  /** Already cleaned by the caller. */
  fileName: string;
  bytes: Uint8Array;
  signal?: AbortSignal;
}

export type ResumeService = ReturnType<typeof createResumeService>;

// Resume library operations (Database Design §7.2–7.3). Callers pass the verified user ID;
// "not found" (missing, deleted or someone else's resume) is returned as null.
export function createResumeService(deps: ResumeServiceDeps) {
  const { pool, storage, pdf, resumes, cleanup } = deps;
  const log = deps.log ?? ((message, details) => console.error(message, details ?? ""));

  // Called only when no row references the object.
  async function removeUnusedObject(objectKey: string): Promise<void> {
    try {
      await storage.delete(objectKey);
      return;
    } catch {
      // Fall through to the retry queue.
    }
    try {
      await cleanup.enqueue(pool, objectKey, "upload_rollback");
    } catch {
      log("Upload rollback: could not delete or queue the unused R2 object", { objectKey });
    }
  }

  // The PDF is in R2 but the insert failed. Never delete the object of a row that may exist.
  async function recoverFailedInsert(row: NewResumeRow, insertError: unknown): Promise<ResumeRow> {
    if (!isDefiniteDbFailure(insertError)) {
      // No answer from PostgreSQL: the insert may have committed.
      let saved: ResumeRow | null;
      try {
        saved = await resumes.findLiveByObjectKey(pool, row.objectKey);
      } catch {
        log("Upload: insert outcome unknown, R2 object kept", { objectKey: row.objectKey });
        throw new ServiceUnavailableError();
      }
      if (saved) return saved;
    }
    await removeUnusedObject(row.objectKey);
    throw insertError;
  }

  return {
    /** Throws PdfError for rejected files. Returns the new resume. */
    async upload({ userId, name, fileName, bytes, signal }: UploadInput): Promise<ResumeRow> {
      const result = await validateResumePdf(bytes, pdf, { signal });
      const row: NewResumeRow = {
        id: randomUUID(), userId, name, originalFilename: fileName,
        objectKey: createObjectKey(), sizeBytes: bytes.byteLength, ...textFields(result),
      };
      await storage.putNew(row.objectKey, bytes, { signal });
      // The file is stored. Finish the insert even if the client has gone away,
      // so a disconnect can't leave a stored file without a row.
      try {
        return await resumes.insert(pool, row);
      } catch (error) {
        return await recoverFailedInsert(row, error);
      }
    },

    list(userId: string): Promise<ResumeRow[]> {
      return resumes.listLive(pool, userId);
    },

    get(userId: string, id: string): Promise<ResumeRow | null> {
      return resumes.getLive(pool, userId, id);
    },

    async download(userId: string, id: string, signal?: AbortSignal): Promise<{ resume: ResumeRow; bytes: Uint8Array } | null> {
      const resume = await resumes.getLive(pool, userId, id);
      if (!resume) return null;
      const file = await storage.read(resume.objectKey, { signal });
      if (file) return { resume, bytes: file.bytes };
      // No object in R2: fine if the resume was deleted while we were reading, a bug otherwise.
      if (!(await resumes.getLive(pool, userId, id))) return null;
      throw new Error(`R2 object missing for live resume ${id}`);
    },

    /** The R2 object is removed later by the cleanup worker, after the delete has committed. */
    remove(userId: string, id: string): Promise<{ unlinkedApplicationCount: number } | null> {
      return resumes.deleteAndUnlink(pool, userId, id);
    },
  };
}

function textFields(result: ResumePdfResult) {
  if (result.textStatus === "available") {
    const { text, pageCount, nonWhitespaceChars } = result.extraction;
    return { parseStatus: "succeeded", extractedText: text, pageCount, nonWhitespaceChars } as const;
  }
  const { pageCount, nonWhitespaceChars } = result;
  return { parseStatus: "text_unavailable", extractedText: null, pageCount, nonWhitespaceChars } as const;
}
