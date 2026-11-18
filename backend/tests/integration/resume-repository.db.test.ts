import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { withTransaction } from "../../src/db/transaction.js";
import { createPostgresResumeRepository, createPostgresStorageCleanupRepository } from "../../src/modules/resumes/postgres-repository.js";
import type { NewResumeRow } from "../../src/modules/resumes/repository.js";
import { toPublicResume } from "../../src/modules/resumes/routes.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

function readableResume(userId: string, name: string, id = randomUUID()): NewResumeRow {
  return {
    id, userId, name, originalFilename: "cv.pdf", objectKey: `resumes/${id}.pdf`, sizeBytes: 256,
    pageCount: 2, nonWhitespaceChars: 120, parseStatus: "succeeded", extractedText: "a".repeat(120),
  };
}

test("resume reads are owner-scoped and map both parse states and real link counts", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first, second } = await insertTestOwners(pool);
  const resumes = createPostgresResumeRepository(createPostgresStorageCleanupRepository());
  const readable = readableResume(first.id, "Readable resume", "10000000-0000-4000-8000-000000000001");
  const scanned: NewResumeRow = {
    ...readableResume(first.id, "Scanned resume", "10000000-0000-4000-8000-000000000002"),
    parseStatus: "text_unavailable", extractedText: null, pageCount: 1, nonWhitespaceChars: 8,
  };
  const foreign = readableResume(second.id, "Other owner's resume");

  const [saved, scan] = await withTransaction(pool, async (client) => {
    const saved = await resumes.insert(client, readable);
    const scan = await resumes.insert(client, scanned);
    await resumes.insert(client, foreign);
    return [saved, scan];
  });

  assert.deepEqual(saved, {
    id: readable.id, userId: first.id, name: readable.name, originalFilename: readable.originalFilename,
    objectKey: readable.objectKey, sizeBytes: 256, parseStatus: "succeeded",
    createdAt: scan.createdAt, linkedApplicationCount: 0,
  });
  assert.ok(saved.createdAt instanceof Date);
  const { rows: metadata } = await pool.query(`
    SELECT page_count, non_whitespace_chars, extracted_text
    FROM public.resumes WHERE id IN ($1, $2) ORDER BY parse_status
  `, [readable.id, scanned.id]);
  assert.deepEqual(metadata, [
    { page_count: 2, non_whitespace_chars: 120, extracted_text: readable.extractedText },
    { page_count: 1, non_whitespace_chars: 8, extracted_text: null },
  ]);

  const { rows: [application] } = await pool.query<{ id: string }>(`
    INSERT INTO public.applications (user_id, company_name, position_title, resume_id)
    VALUES ($1, 'Example Company', 'Engineer', $2) RETURNING id
  `, [first.id, scan.id]);
  const linkedScan = await resumes.getLive(pool, first.id, scan.id);
  assert.ok(linkedScan);
  assert.deepEqual(toPublicResume(linkedScan), {
    id: scan.id, name: scan.name, fileName: scan.originalFilename, mimeType: "application/pdf",
    sizeBytes: scan.sizeBytes, createdAt: scan.createdAt.toISOString(), textStatus: "unavailable", linkedApplicationCount: 1,
  });

  await pool.query("UPDATE public.applications SET resume_id = $1 WHERE id = $2", [saved.id, application.id]);
  await pool.query(`
    INSERT INTO public.applications (user_id, company_name, position_title, resume_id)
    VALUES ($1, 'Example Company', 'Developer', $2)
  `, [first.id, saved.id]);

  const list = await resumes.listLive(pool, first.id);
  assert.deepEqual(list.map(({ id }) => id), [scan.id, saved.id]);
  const shared = await resumes.getLive(pool, first.id, saved.id);
  assert.ok(shared);
  assert.equal(toPublicResume(shared).textStatus, "available");
  assert.equal(toPublicResume(shared).linkedApplicationCount, 2);
  assert.equal(list.find(({ id }) => id === scan.id)?.linkedApplicationCount, 0);
  assert.deepEqual(await resumes.findLiveByObjectKey(pool, saved.objectKey), shared);
  assert.deepEqual((await resumes.listLive(pool, second.id)).map(({ id }) => id), [foreign.id]);
  assert.equal(await resumes.getLive(pool, second.id, saved.id), null);
  assert.equal(await resumes.deleteAndUnlink(pool, second.id, saved.id), null);
}));

test("enqueue failure rolls back deletion and unlinking; retry commits exactly one job", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first } = await insertTestOwners(pool);
  const resumes = createPostgresResumeRepository(createPostgresStorageCleanupRepository());
  const resume = readableResume(first.id, "Shared resume");
  await resumes.insert(pool, resume);
  await pool.query(`
    INSERT INTO public.applications (user_id, company_name, position_title, resume_id, updated_at)
    VALUES ($1, 'Example Company', 'Developer', $2, '2026-01-01Z'),
           ($1, 'Example Company', 'Engineer', $2, '2026-01-01Z')
  `, [first.id, resume.id]);

  const reader = await pool.connect();
  try {
    const resumeState = async () => (await reader.query(`
      SELECT extracted_text, deleted_at, updated_at FROM public.resumes WHERE id = $1
    `, [resume.id])).rows[0];
    const applications = async () => (await reader.query(`
      SELECT id, position_title, resume_id, row_version, updated_at FROM public.applications ORDER BY id
    `)).rows;
    const jobs = async () => (await reader.query(`
      SELECT object_key, reason, status FROM public.storage_cleanup_jobs
    `)).rows;
    const originalResume = await resumeState();
    const originalApplications = await applications();

    await reader.query(`
      ALTER TABLE public.storage_cleanup_jobs
      ADD CONSTRAINT reject_test_enqueue CHECK (reason <> 'resume_deleted')
    `);
    await assert.rejects(resumes.deleteAndUnlink(pool, first.id, resume.id), { code: "23514", constraint: "reject_test_enqueue" });
    assert.equal(originalResume.extracted_text, resume.extractedText);
    assert.equal(originalResume.deleted_at, null);
    assert.deepEqual(await resumeState(), originalResume);
    assert.deepEqual(await applications(), originalApplications);
    assert.deepEqual(await jobs(), []);

    await reader.query("ALTER TABLE public.storage_cleanup_jobs DROP CONSTRAINT reject_test_enqueue");
    assert.deepEqual(await resumes.deleteAndUnlink(pool, first.id, resume.id), { unlinkedApplicationCount: 2 });
    const deleted = await resumeState();
    assert.ok(deleted.deleted_at instanceof Date);
    assert.equal(deleted.extracted_text, null);
    const unlinked = await applications();
    assert.deepEqual(unlinked.map(({ id, position_title, resume_id, row_version }) => ({ id, position_title, resume_id, row_version })),
      originalApplications.map(({ id, position_title }) => ({ id, position_title, resume_id: null, row_version: "2" })));
    assert.ok(unlinked.every((row, index) => row.updated_at > originalApplications[index].updated_at));
    assert.equal(await resumes.findLiveByObjectKey(pool, resume.objectKey), null);
    assert.equal(await resumes.getLive(pool, first.id, resume.id), null);
    assert.deepEqual(await resumes.listLive(pool, first.id), []);
    assert.equal(await resumes.deleteAndUnlink(pool, first.id, resume.id), null);
    assert.deepEqual(await applications(), unlinked);
    assert.deepEqual(await jobs(), [{ object_key: resume.objectKey, reason: "resume_deleted", status: "pending" }]);
  } finally {
    reader.release();
  }
}));

test("cleanup jobs deduplicate, skip locked or future rows, and retry when due", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const cleanup = createPostgresStorageCleanupRepository();
  const key = "resumes/due.pdf";
  await cleanup.enqueue(pool, key, "resume_deleted");
  await cleanup.enqueue(pool, key, "resume_deleted");
  await cleanup.enqueue(pool, key, "upload_rollback");
  await pool.query(`
    INSERT INTO public.storage_cleanup_jobs (object_key, reason, next_attempt_at)
    VALUES ('resumes/future.pdf', 'orphan', CURRENT_TIMESTAMP + interval '1 day')
  `);

  const [first, second] = await withTransaction(pool, async (client) => {
    const [first] = await cleanup.claimDue(client, 1);
    const [second] = await withTransaction(pool, async (concurrent) => {
      await concurrent.query("SET LOCAL lock_timeout = '2s'");
      return cleanup.claimDue(concurrent, 1);
    });
    return [first, second];
  });
  assert.notEqual(first.id, second.id);
  assert.equal(first.objectKey, key);
  assert.equal(second.objectKey, key);
  assert.deepEqual(new Set([first.reason, second.reason]), new Set(["resume_deleted", "upload_rollback"]));
  assert.equal(second.attemptCount, 0);
  assert.deepEqual(await cleanup.claimDue(pool, 10), []);

  const { rows: [clock] } = await pool.query<{ retry_at: Date }>("SELECT CURRENT_TIMESTAMP + interval '1 hour' AS retry_at");
  await cleanup.complete(pool, first.id);
  await cleanup.fail(pool, second.id, "timeout", clock.retry_at);
  const { rows: [retry] } = await pool.query(`
    SELECT status, attempt_count, last_error_code, next_attempt_at FROM public.storage_cleanup_jobs WHERE id = $1
  `, [second.id]);
  assert.deepEqual(retry, { status: "pending", attempt_count: 1, last_error_code: "timeout", next_attempt_at: clock.retry_at });
  assert.deepEqual(await cleanup.claimDue(pool, 10), []);

  await pool.query("UPDATE public.storage_cleanup_jobs SET next_attempt_at = CURRENT_TIMESTAMP WHERE id = $1", [second.id]);
  const claimed = { ...second, attemptCount: 1 };
  assert.deepEqual(await cleanup.claimDue(pool, 10), [claimed]);
  assert.equal(await cleanup.requeueProcessing(pool), 1);
  assert.equal(await cleanup.requeueProcessing(pool), 0);
  assert.deepEqual(await cleanup.claimDue(pool, 10), [claimed]);
  await cleanup.complete(pool, second.id);
  assert.deepEqual(await cleanup.claimDue(pool, 10), []);
  const { rows: statuses } = await pool.query("SELECT status FROM public.storage_cleanup_jobs ORDER BY status");
  assert.deepEqual(statuses, [{ status: "done" }, { status: "done" }, { status: "pending" }]);

  await assert.rejects(pool.query("UPDATE public.storage_cleanup_jobs SET status = 'invalid' WHERE id = $1", [first.id]),
    { code: "23514", constraint: "storage_cleanup_jobs_status_check" });
  await assert.rejects(pool.query("UPDATE public.storage_cleanup_jobs SET attempt_count = -1 WHERE id = $1", [first.id]),
    { code: "23514", constraint: "storage_cleanup_jobs_attempt_count_check" });
}));
