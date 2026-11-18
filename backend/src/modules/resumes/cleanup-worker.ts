import type { Pool } from "pg";
import { StorageError, type ObjectStorage } from "../../integrations/object-storage/types.js";
import type { CleanupJob, ResumeRepository, StorageCleanupRepository } from "./repository.js";
import type { Log } from "./service.js";

// Deletes R2 objects queued in storage_cleanup_jobs (Database Design §5.11): files of deleted
// resumes, and uploads whose database insert failed. Runs inside the single backend process.

const INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;
// Wait after the 1st, 2nd, 3rd and 4th failed attempt; after that, every 6 hours, forever.
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
const LATER_RETRY_MS = 6 * 3_600_000;

export interface CleanupWorkerDeps {
  pool: Pool;
  storage: ObjectStorage;
  resumes: ResumeRepository;
  cleanup: StorageCleanupRepository;
  log?: Log;
  now?: () => Date;
}

/** When to try again after a failure, given the failed attempts before this one. */
export function nextAttemptAt(previousFailures: number, now: Date): Date {
  return new Date(now.getTime() + (RETRY_DELAYS_MS[previousFailures] ?? LATER_RETRY_MS));
}

/** Claims and processes one batch. Returns how many jobs were claimed. */
export async function runCleanupOnce(deps: CleanupWorkerDeps): Promise<number> {
  const { pool, cleanup } = deps;
  const jobs = await cleanup.claimDue(pool, BATCH_SIZE);
  for (const job of jobs) await processJob(deps, job);
  return jobs.length;
}

async function processJob(deps: CleanupWorkerDeps, job: CleanupJob): Promise<void> {
  const { pool, storage, resumes, cleanup } = deps;
  const log = deps.log ?? defaultLog;
  try {
    // Safety net: never delete the file of a live resume, whatever queued this job.
    if (await resumes.findLiveByObjectKey(pool, job.objectKey)) {
      log("Cleanup skipped: object belongs to a live resume (still_referenced)", { jobId: job.id, objectKey: job.objectKey });
      await cleanup.complete(pool, job.id);
      return;
    }
    await storage.delete(job.objectKey); // succeeds if the object is already gone
    await cleanup.complete(pool, job.id);
  } catch (error) {
    const code = error instanceof StorageError ? error.code : "unexpected_error";
    // If this also fails, the job stays "processing" until resetInterrupted runs at the next start.
    await cleanup.fail(pool, job.id, code, nextAttemptAt(job.attemptCount, (deps.now ?? (() => new Date()))()));
  }
}

/**
 * Resets jobs interrupted by a crash, runs one pass now, then one every 30 s (never two
 * at once). stop() cancels the timer and waits for a running pass.
 */
export function startCleanupWorker(deps: CleanupWorkerDeps, { intervalMs = INTERVAL_MS } = {}) {
  const log = deps.log ?? defaultLog;
  let active: Promise<void> | undefined;

  const pass = async () => {
    try {
      await runCleanupOnce(deps);
    } catch (error) {
      log("Cleanup pass failed; retrying on the next tick", { error: errorMessage(error) });
    }
  };
  const run = (work: () => Promise<void>) => {
    if (active) return;
    active = work().finally(() => { active = undefined; });
  };

  run(async () => {
    try {
      await deps.cleanup.resetInterrupted(deps.pool);
    } catch (error) {
      log("Cleanup: could not reset interrupted jobs", { error: errorMessage(error) });
    }
    await pass();
  });
  const timer = setInterval(() => run(pass), intervalMs);
  timer.unref(); // the HTTP server keeps the process alive, not this timer

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await active;
    },
  };
}

const defaultLog = (message: string, details?: Record<string, unknown>) => console.error(message, details ?? "");
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
