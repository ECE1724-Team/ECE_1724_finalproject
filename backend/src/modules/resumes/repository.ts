import type { Pool, PoolClient } from "pg";

// Interfaces for the resume and storage-cleanup SQL (Database Design §5.2, §5.11,
// §7.2–7.3, Appendix C.4). The resume module defines them as the caller; the SQL
// implementation is written separately. Tests use in-memory fakes from tests/fakes.
// Repositories return camelCase objects; snake_case stays inside the SQL.

/** The pool, or a client inside a transaction. */
export type Db = Pool | PoolClient;

export type ParseStatus = "succeeded" | "text_unavailable";

/** A live (not deleted) resume, without its extracted text. */
export interface ResumeRow {
  id: string;
  userId: string;
  name: string;
  originalFilename: string;
  /** Private R2 key. Never sent to the browser. */
  objectKey: string;
  sizeBytes: number;
  parseStatus: ParseStatus;
  createdAt: Date;
  /** Live applications of the same owner linked to this resume (§8.5). */
  linkedApplicationCount: number;
}

interface NewResumeBase {
  id: string;
  userId: string;
  name: string;
  originalFilename: string;
  objectKey: string;
  sizeBytes: number;
  pageCount: number;
  nonWhitespaceChars: number;
}

/** mime_type is always application/pdf. A text_unavailable row never stores text. */
export type NewResumeRow =
  | (NewResumeBase & { parseStatus: "succeeded"; extractedText: string })
  | (NewResumeBase & { parseStatus: "text_unavailable"; extractedText: null });

export interface ResumeRepository {
  /** Inserts one row and returns it as stored (linkedApplicationCount is 0). */
  insert(db: Db, row: NewResumeRow): Promise<ResumeRow>;
  /** The owner's live resumes, newest first (created_at DESC, id DESC). */
  listLive(db: Db, userId: string): Promise<ResumeRow[]>;
  /** null when the resume is missing, deleted, or owned by someone else. */
  getLive(db: Db, userId: string, id: string): Promise<ResumeRow | null>;
  /** The live resume stored under this key, if any. Used after an unclear insert and by the cleanup worker. */
  findLiveByObjectKey(db: Db, objectKey: string): Promise<ResumeRow | null>;
  /**
   * Opens and commits its own transaction (§7.3): lock the resume, then the linked
   * applications in id order; set deleted_at, unlink the applications (row_version + 1),
   * clear extracted_text, and enqueue a `resume_deleted` cleanup job for the object key.
   * Returns null when the resume is missing, deleted, or owned by someone else.
   */
  deleteAndUnlink(pool: Pool, userId: string, id: string): Promise<{ unlinkedApplicationCount: number } | null>;
}

export type CleanupReason = "resume_deleted" | "upload_rollback";

export interface CleanupJob {
  id: string;
  objectKey: string;
  reason: CleanupReason;
  /** Failed attempts so far. */
  attemptCount: number;
}

export interface StorageCleanupRepository {
  enqueue(db: Db, objectKey: string, reason: CleanupReason): Promise<void>;
  /** Claims up to `limit` jobs that are due (FOR UPDATE SKIP LOCKED) and marks them processing. */
  claimDue(db: Db, limit: number): Promise<CleanupJob[]>;
  complete(db: Db, jobId: string): Promise<void>;
  /** Records the error, increments attempt_count, sets status back to pending until nextAttemptAt. */
  fail(db: Db, jobId: string, errorCode: string, nextAttemptAt: Date): Promise<void>;
  /**
   * Puts every processing job back to pending. Returns how many. The worker calls it before
   * each pass, which is safe only because there is one backend instance and passes never overlap.
   */
  resetInterrupted(db: Db): Promise<number>;
}
