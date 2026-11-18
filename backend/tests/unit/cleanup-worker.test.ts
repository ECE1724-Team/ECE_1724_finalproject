import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import type { Pool } from "pg";
import { StorageError } from "../../src/integrations/object-storage/types.js";
import { nextAttemptAt, runCleanupOnce, startCleanupWorker } from "../../src/modules/resumes/cleanup-worker.js";
import { FakeCleanupRepository, FakeResumeRepository, FakeStorage, collectLogs } from "../fakes/resumes.js";

const NOW = new Date("2026-11-17T12:00:00Z");

function setup() {
  const cleanup = new FakeCleanupRepository();
  cleanup.now = () => NOW;
  const resumes = new FakeResumeRepository(cleanup);
  const storage = new FakeStorage();
  const logs = collectLogs();
  const deps = { pool: {} as Pool, storage, resumes, cleanup, log: logs.log, now: () => NOW };
  return { deps, cleanup, resumes, storage, logs };
}

test("a due job deletes the R2 object and completes", async () => {
  const { deps, cleanup, storage } = setup();
  storage.objects.set("resumes/old.pdf", new Uint8Array([1]));
  await cleanup.enqueue(null, "resumes/old.pdf", "resume_deleted");
  await cleanup.enqueue(null, "resumes/already-gone.pdf", "upload_rollback");
  assert.equal(await runCleanupOnce(deps), 2);
  assert.equal(storage.objects.size, 0);
  assert.deepEqual(cleanup.jobs.map((job) => job.status), ["done", "done"]);
  assert.equal(await runCleanupOnce(deps), 0);
});

test("a failed delete is retried after 1 min, 5 min, 30 min, 2 h, then every 6 h", async () => {
  const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
  assert.deepEqual([0, 1, 2, 3, 4, 10].map((failures) => nextAttemptAt(failures, NOW)),
    [minutes(1), minutes(5), minutes(30), minutes(120), minutes(360), minutes(360)]);

  const { deps, cleanup, storage } = setup();
  storage.deleteError = new StorageError("access_denied");
  await cleanup.enqueue(null, "resumes/locked.pdf", "resume_deleted");
  await runCleanupOnce(deps);
  assert.deepEqual(cleanup.jobs[0], {
    id: "job-1", objectKey: "resumes/locked.pdf", reason: "resume_deleted", attemptCount: 1,
    status: "pending", nextAttemptAt: minutes(1), lastErrorCode: "access_denied",
  });
  assert.equal(await runCleanupOnce(deps), 0, "not due yet");
});

test("the object of a live resume is never deleted", async () => {
  const { deps, cleanup, resumes, storage, logs } = setup();
  resumes.seed({ id: "d0000000-0000-4000-8000-000000000001", userId: "u", objectKey: "resumes/live.pdf" });
  storage.objects.set("resumes/live.pdf", new Uint8Array([1]));
  await cleanup.enqueue(null, "resumes/live.pdf", "upload_rollback");
  await runCleanupOnce(deps);
  assert.equal(storage.objects.has("resumes/live.pdf"), true);
  assert.equal(cleanup.jobs[0].status, "done");
  assert.match(logs.entries[0].message, /still_referenced/);
});

test("start resets interrupted jobs and runs a pass; a failing pass is logged; stop waits", async () => {
  const { deps, cleanup, storage, logs } = setup();
  await cleanup.enqueue(null, "resumes/stuck.pdf", "resume_deleted");
  cleanup.jobs[0].status = "processing"; // left behind by a crash
  storage.objects.set("resumes/stuck.pdf", new Uint8Array([1]));

  const worker = startCleanupWorker(deps, { intervalMs: 5 });
  await worker.stop();
  assert.equal(cleanup.jobs[0].status, "done");
  assert.equal(storage.objects.size, 0);

  cleanup.claimError = new Error("database down");
  const failing = startCleanupWorker(deps, { intervalMs: 5 });
  await sleep(20);
  await failing.stop();
  assert.ok(logs.entries.length >= 2, "first pass and at least one timer pass are logged");
  assert.ok(logs.entries.every((entry) => /Cleanup pass failed/.test(entry.message)));
});

test("a pass that stops midway leaves no job stuck: the next pass puts the batch back", async () => {
  const { deps, cleanup, resumes, storage, logs } = setup();
  for (const key of ["resumes/a.pdf", "resumes/b.pdf"]) {
    storage.objects.set(key, new Uint8Array([1]));
    await cleanup.enqueue(null, key, "resume_deleted");
  }
  // Database blip: the live-resume check fails, and recording the failure fails too.
  resumes.lookupError = new Error("Connection terminated unexpectedly");
  cleanup.failError = resumes.lookupError;

  const worker = startCleanupWorker(deps, { intervalMs: 5 });
  await new Promise((resolve) => setImmediate(resolve)); // the first pass uses only in-memory fakes
  assert.deepEqual(cleanup.jobs.map((job) => job.status), ["processing", "processing"]);
  assert.ok(logs.entries.some((entry) => entry.message === "Cleanup job failed unexpectedly" && entry.details?.jobId === "job-1"));

  resumes.lookupError = undefined;
  cleanup.failError = undefined;
  await sleep(20);
  await worker.stop();
  assert.deepEqual(cleanup.jobs.map((job) => job.status), ["done", "done"]);
  assert.equal(storage.objects.size, 0);
});
