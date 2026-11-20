import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { StorageError } from "../../src/integrations/object-storage/types.js";
import { PdfError } from "../../src/integrations/pdf/types.js";
import { ServiceUnavailableError } from "../../src/modules/resumes/errors.js";
import { MAX_RESUME_BYTES } from "../../src/modules/resumes/pdf-policy.js";
import { createResumeService } from "../../src/modules/resumes/service.js";
import {
  FakeCleanupRepository, FakeResumeRepository, FakeStorage, collectLogs, extraction, fakeExtractor, pdfBytes, pgError,
} from "../fakes/resumes.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function setup(result = extraction() as ReturnType<typeof extraction> | PdfError) {
  const cleanup = new FakeCleanupRepository();
  const resumes = new FakeResumeRepository(cleanup);
  const storage = new FakeStorage();
  const pdf = fakeExtractor(result);
  const logs = collectLogs();
  const service = createResumeService({ pool: {} as Pool, storage, pdf, resumes, cleanup, log: logs.log });
  const upload = (extra: { signal?: AbortSignal; bytes?: Uint8Array } = {}) => service.upload({
    userId: USER, name: "Backend resume", fileName: "cv.pdf", bytes: extra.bytes ?? pdfBytes(), signal: extra.signal,
  });
  return { service, resumes, cleanup, storage, pdf, logs, upload };
}

const connectionLost = () => new Error("Connection terminated unexpectedly");

test("upload with usable text stores the file and a succeeded row with its text", async () => {
  const { upload, resumes, storage } = setup(extraction("Alex Example ".repeat(20)));
  const row = await upload();
  assert.equal(row.parseStatus, "succeeded");
  assert.equal(row.linkedApplicationCount, 0);
  assert.match(row.objectKey, /^resumes\/[0-9a-f-]{36}\.pdf$/);
  assert.deepEqual(storage.objects.get(row.objectKey), new Uint8Array(pdfBytes()));
  const stored = resumes.rows.get(row.id)!;
  assert.equal(stored.extractedText, "Alex Example ".repeat(20));
  assert.equal(stored.sizeBytes, pdfBytes().byteLength);
  assert.equal(stored.nonWhitespaceChars, 220);
});

test("upload without usable text stores a text_unavailable row with no text", async () => {
  const { upload, resumes } = setup(extraction("too short"));
  const row = await upload();
  assert.equal(row.parseStatus, "text_unavailable");
  const stored = resumes.rows.get(row.id)!;
  assert.equal(stored.extractedText, null);
  assert.equal(stored.nonWhitespaceChars, 8);
});

test("rejected files are never stored", async () => {
  for (const code of ["invalid_pdf", "too_many_pages", "unreadable_encryption", "busy", "timeout"] as const) {
    const { upload, storage, resumes } = setup(new PdfError(code));
    await assert.rejects(upload(), { code });
    assert.equal(storage.calls.length, 0);
    assert.equal(resumes.rows.size, 0);
  }
  const { upload, pdf, storage } = setup();
  await assert.rejects(upload({ bytes: pdfBytes(MAX_RESUME_BYTES + 1) }), { code: "too_large" });
  assert.equal(pdf.calls, 0);
  assert.equal(storage.calls.length, 0);
});

test("a failed R2 write leaves no row", async () => {
  const { upload, storage, resumes } = setup();
  storage.putError = new StorageError("service_error");
  await assert.rejects(upload(), { code: "service_error" });
  assert.equal(resumes.rows.size, 0);
});

test("insert rejected by PostgreSQL: the object is deleted, or queued, or logged", async () => {
  const deleted = setup();
  deleted.resumes.insertError = pgError("23505");
  await assert.rejects(deleted.upload(), { code: "23505" });
  assert.equal(deleted.storage.objects.size, 0);
  assert.equal(deleted.cleanup.jobs.length, 0);

  const queued = setup();
  queued.resumes.insertError = pgError("23514");
  queued.storage.deleteError = new StorageError("service_error");
  await assert.rejects(queued.upload(), { code: "23514" });
  assert.equal(queued.cleanup.jobs.length, 1);
  assert.equal(queued.cleanup.jobs[0].reason, "upload_rollback");
  assert.equal(queued.storage.objects.size, 1);

  const logged = setup();
  logged.resumes.insertError = pgError("23514");
  logged.storage.deleteError = new StorageError("service_error");
  logged.cleanup.enqueueError = pgError("57P01");
  await assert.rejects(logged.upload(), { code: "23514" });
  const [key] = logged.storage.objects.keys();
  assert.deepEqual(logged.logs.entries.map((entry) => entry.details?.objectKey), [key]);
});

test("insert outcome unknown: the lookup finds the committed row and keeps its PDF", async () => {
  for (const error of [
    connectionLost(),
    Object.assign(pgError("57P01"), { severity: "ВАЖНО" }), // localized shutdown message
    Object.assign(new Error("write EPIPE"), { code: "EPIPE" }), // five letters, but not a SQLSTATE
  ]) {
    const { service, upload, resumes, storage } = setup();
    resumes.insertError = error;
    resumes.insertCommitsBeforeError = true;
    const row = await upload();
    assert.deepEqual((await service.download(USER, row.id))?.bytes, new Uint8Array(pdfBytes()));
    assert.equal(storage.calls.some((call) => call.startsWith("delete")), false);
  }
});

test("an empty recovery lookup preserves the object when insert completion is unknown", async () => {
  const fatal = Object.assign(pgError("57P01"), { severity: "FATAL" });
  for (const error of [connectionLost(), new Error("Query read timeout"), pgError("08007"), pgError("40003"), fatal]) {
    const { upload, resumes, storage, cleanup } = setup();
    resumes.insertError = error;
    await assert.rejects(upload(), ServiceUnavailableError);
    assert.equal(storage.objects.size, 1);
    assert.deepEqual(cleanup.jobs, []);
  }
});

test("insert outcome unknown and the lookup fails too: keep the object, report unavailable", async () => {
  const { upload, resumes, storage, logs } = setup();
  resumes.insertError = connectionLost();
  resumes.lookupError = connectionLost();
  await assert.rejects(upload(), ServiceUnavailableError);
  assert.equal(storage.objects.size, 1);
  assert.equal(storage.calls.some((call) => call.startsWith("delete")), false);
  assert.equal(logs.entries.length, 1);
});

test("a cancel before the R2 write stores nothing; after it, the insert still finishes", async () => {
  const before = setup();
  const early = new AbortController();
  early.abort();
  await assert.rejects(before.upload({ signal: early.signal }), { code: "cancelled" });
  assert.equal(before.storage.objects.size, 0);

  const after = setup();
  const late = new AbortController();
  after.storage.afterPut = () => late.abort();
  const row = await after.upload({ signal: late.signal });
  assert.equal(after.resumes.rows.has(row.id), true);
  assert.equal(after.storage.objects.has(row.objectKey), true);
});

test("list and get only see the owner's live resumes, newest first", async () => {
  const { service, resumes } = setup();
  const older = resumes.seed({ id: "a0000000-0000-4000-8000-000000000001", userId: USER, objectKey: "resumes/a.pdf" });
  const newer = resumes.seed({ id: "a0000000-0000-4000-8000-000000000002", userId: USER, objectKey: "resumes/b.pdf" });
  const foreign = resumes.seed({ id: "a0000000-0000-4000-8000-000000000003", userId: OTHER, objectKey: "resumes/c.pdf" });
  const deleted = resumes.seed({
    id: "a0000000-0000-4000-8000-000000000004", userId: USER, objectKey: "resumes/d.pdf", deletedAt: new Date(),
  });
  assert.deepEqual((await service.list(USER)).map((row) => row.id), [newer.id, older.id]);
  assert.equal((await service.get(USER, older.id))?.id, older.id);
  assert.equal(await service.get(USER, foreign.id), null);
  assert.equal(await service.get(USER, deleted.id), null);
});

test("download returns the bytes; a missing object is 404 only if the resume was deleted meanwhile", async () => {
  const { service, resumes, storage } = setup();
  const row = resumes.seed({ id: "b0000000-0000-4000-8000-000000000001", userId: USER, objectKey: "resumes/x.pdf" });
  storage.objects.set(row.objectKey, new Uint8Array([1, 2, 3]));
  assert.deepEqual((await service.download(USER, row.id))?.bytes, new Uint8Array([1, 2, 3]));
  assert.equal(await service.download(OTHER, row.id), null);

  storage.objects.clear();
  await assert.rejects(service.download(USER, row.id), /R2 object missing/);

  storage.beforeRead = () => { resumes.rows.get(row.id)!.deletedAt = new Date(); };
  assert.equal(await service.download(USER, row.id), null);
});

test("remove reports the unlink count, queues cleanup, and never calls R2 itself", async () => {
  const { service, resumes, storage, cleanup } = setup();
  const row = resumes.seed({
    id: "c0000000-0000-4000-8000-000000000001", userId: USER, objectKey: "resumes/y.pdf", linkedApplicationCount: 2,
  });
  assert.equal(await service.remove(OTHER, row.id), null);
  assert.deepEqual(await service.remove(USER, row.id), { unlinkedApplicationCount: 2 });
  assert.equal(await service.remove(USER, row.id), null);
  assert.equal(storage.calls.length, 0);
  assert.deepEqual(cleanup.jobs.map((job) => [job.objectKey, job.reason]), [["resumes/y.pdf", "resume_deleted"]]);
});
