// In-memory fakes for resume tests. Never used at runtime.
import { StorageError, type ObjectMetadata, type ObjectStorage, type StoredObject } from "../../src/integrations/object-storage/types.js";
import { PdfError, type PdfExtraction, type PdfExtractor } from "../../src/integrations/pdf/types.js";
import type {
  CleanupJob, CleanupReason, NewResumeRow, ResumeRepository, ResumeRow, StorageCleanupRepository,
} from "../../src/modules/resumes/repository.js";

type StoredResume = NewResumeRow & { createdAt: Date; deletedAt: Date | null; linkedApplicationCount: number };

export class FakeResumeRepository implements ResumeRepository {
  readonly rows = new Map<string, StoredResume>();
  /** insert throws this error. */
  insertError: unknown;
  /** With insertError: the row is saved first, as when a commit succeeds but its reply is lost. */
  insertCommitsBeforeError = false;
  /** findLiveByObjectKey throws this error. */
  lookupError: unknown;
  private clock = Date.parse("2026-11-01T00:00:00Z");

  constructor(private readonly cleanup?: FakeCleanupRepository) {}

  /** Adds a live resume directly, for read and delete tests. */
  seed(fields: Partial<StoredResume> & { id: string; userId: string; objectKey: string }): ResumeRow {
    const stored = {
      name: "Seeded resume", originalFilename: "seed.pdf", sizeBytes: 100, pageCount: 1,
      nonWhitespaceChars: 150, parseStatus: "succeeded", extractedText: "text",
      createdAt: this.nextTime(), deletedAt: null, linkedApplicationCount: 0, ...fields,
    } as StoredResume;
    this.rows.set(stored.id, stored);
    return toRow(stored);
  }

  async insert(_db: unknown, row: NewResumeRow): Promise<ResumeRow> {
    if (this.insertError !== undefined && !this.insertCommitsBeforeError) throw this.insertError;
    const stored: StoredResume = { ...row, createdAt: this.nextTime(), deletedAt: null, linkedApplicationCount: 0 };
    this.rows.set(row.id, stored);
    if (this.insertError !== undefined) throw this.insertError;
    return toRow(stored);
  }

  async listLive(_db: unknown, userId: string): Promise<ResumeRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId && !row.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .map(toRow);
  }

  async getLive(_db: unknown, userId: string, id: string): Promise<ResumeRow | null> {
    const row = this.rows.get(id);
    return row && row.userId === userId && !row.deletedAt ? toRow(row) : null;
  }

  async findLiveByObjectKey(_db: unknown, objectKey: string): Promise<ResumeRow | null> {
    if (this.lookupError !== undefined) throw this.lookupError;
    const row = [...this.rows.values()].find((r) => r.objectKey === objectKey && !r.deletedAt);
    return row ? toRow(row) : null;
  }

  async deleteAndUnlink(_pool: unknown, userId: string, id: string) {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId || row.deletedAt) return null;
    const unlinkedApplicationCount = row.linkedApplicationCount;
    Object.assign(row, { deletedAt: new Date(), extractedText: null, linkedApplicationCount: 0 });
    await this.cleanup?.enqueue(null, row.objectKey, "resume_deleted");
    return { unlinkedApplicationCount };
  }

  private nextTime(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }
}

function toRow(row: StoredResume): ResumeRow {
  return {
    id: row.id, userId: row.userId, name: row.name, originalFilename: row.originalFilename,
    objectKey: row.objectKey, sizeBytes: row.sizeBytes, parseStatus: row.parseStatus,
    createdAt: row.createdAt, linkedApplicationCount: row.linkedApplicationCount,
  };
}

type FakeJob = CleanupJob & {
  status: "pending" | "processing" | "done";
  nextAttemptAt: Date;
  lastErrorCode: string | null;
};

export class FakeCleanupRepository implements StorageCleanupRepository {
  readonly jobs: FakeJob[] = [];
  enqueueError: unknown;
  claimError: unknown;
  now = () => new Date();

  async enqueue(_db: unknown, objectKey: string, reason: CleanupReason): Promise<void> {
    if (this.enqueueError !== undefined) throw this.enqueueError;
    this.jobs.push({
      id: `job-${this.jobs.length + 1}`, objectKey, reason, attemptCount: 0,
      status: "pending", nextAttemptAt: this.now(), lastErrorCode: null,
    });
  }

  async claimDue(_db: unknown, limit: number): Promise<CleanupJob[]> {
    if (this.claimError !== undefined) throw this.claimError;
    const due = this.jobs
      .filter((job) => job.status === "pending" && job.nextAttemptAt <= this.now())
      .slice(0, limit);
    for (const job of due) job.status = "processing";
    return due.map(({ id, objectKey, reason, attemptCount }) => ({ id, objectKey, reason, attemptCount }));
  }

  async complete(_db: unknown, jobId: string): Promise<void> {
    this.job(jobId).status = "done";
  }

  async fail(_db: unknown, jobId: string, errorCode: string, nextAttemptAt: Date): Promise<void> {
    Object.assign(this.job(jobId), {
      status: "pending", lastErrorCode: errorCode, nextAttemptAt, attemptCount: this.job(jobId).attemptCount + 1,
    });
  }

  async resetInterrupted(): Promise<number> {
    const stuck = this.jobs.filter((job) => job.status === "processing");
    for (const job of stuck) job.status = "pending";
    return stuck.length;
  }

  private job(id: string): FakeJob {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error(`No fake job ${id}`);
    return job;
  }
}

export class FakeStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly calls: string[] = [];
  putError: unknown;
  deleteError: unknown;
  /** Runs right after a successful putNew. */
  afterPut: (() => void) | undefined;
  /** Runs before read looks up the object. */
  beforeRead: (() => void) | undefined;

  async putNew(key: string, bytes: Uint8Array, options: { signal?: AbortSignal } = {}): Promise<void> {
    this.calls.push(`put ${key}`);
    if (options.signal?.aborted) throw new StorageError("cancelled");
    if (this.putError !== undefined) throw this.putError;
    if (this.objects.has(key)) throw new StorageError("conflict");
    this.objects.set(key, new Uint8Array(bytes));
    this.afterPut?.();
  }

  async read(key: string): Promise<StoredObject | null> {
    this.calls.push(`read ${key}`);
    this.beforeRead?.();
    const bytes = this.objects.get(key);
    return bytes ? { bytes, ...this.metadataOf(bytes) } : null;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const bytes = this.objects.get(key);
    return bytes ? this.metadataOf(bytes) : null;
  }

  async delete(key: string): Promise<void> {
    this.calls.push(`delete ${key}`);
    if (this.deleteError !== undefined) throw this.deleteError;
    this.objects.delete(key);
  }

  private metadataOf(bytes: Uint8Array): ObjectMetadata {
    return { contentType: "application/pdf", contentLength: bytes.byteLength, etag: '"fake"' };
  }
}

/** A PDF extractor that returns a fixed result, or throws, without parsing anything. */
export function fakeExtractor(result: PdfExtraction | PdfError): PdfExtractor & { calls: number } {
  const extractor = {
    calls: 0,
    async extract(_bytes: Uint8Array, options: { signal?: AbortSignal }): Promise<PdfExtraction> {
      extractor.calls++;
      if (options.signal?.aborted) throw new PdfError("cancelled");
      if (result instanceof PdfError) throw result;
      return result;
    },
  };
  return extractor;
}

/** An extraction that passes the text rules (or not, with a short text). */
export function extraction(text = "x".repeat(120)): PdfExtraction {
  const chars = [...text.replace(/\s/gu, "")].length;
  return { text, pageCount: 1, nonWhitespaceChars: chars, pages: [{ pageNumber: 1, text, nonWhitespaceChars: chars }] };
}

/** Starts with the PDF signature so validateResumePdf hands it to the (fake) extractor. */
export const pdfBytes = (size = 64) => {
  const bytes = Buffer.alloc(size, 32);
  bytes.write("%PDF-1.7\n");
  return bytes;
};

/** A collecting logger. */
export function collectLogs() {
  const entries: { message: string; details?: Record<string, unknown> }[] = [];
  return { entries, log: (message: string, details?: Record<string, unknown>) => { entries.push({ message, details }); } };
}
