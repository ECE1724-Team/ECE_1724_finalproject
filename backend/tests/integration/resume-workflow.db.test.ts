import assert from "node:assert/strict";
import { test } from "node:test";
import { StorageError } from "../../src/integrations/object-storage/types.js";
import { createPostgresResumeModule } from "../../src/modules/resumes/postgres-module.js";
import { FakeStorage, collectLogs, extraction, fakeExtractor, pdfBytes } from "../fakes/resumes.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

test("the PostgreSQL resume module uploads, unlinks, and retries private object cleanup after restart", () =>
  withTestDatabase(async ({ pool, migrate }) => {
    await migrate();
    const { first } = await insertTestOwners(pool);
    const storage = new FakeStorage();
    const parsed = extraction();
    const logs = collectLogs();
    const deps = { pool, storage, pdf: fakeExtractor(parsed), log: logs.log };
    const resumes = createPostgresResumeModule(deps);
    const bytes = pdfBytes();
    const upload = (name: string) => resumes.service.upload({ userId: first.id, name, fileName: "cv.pdf", bytes });
    const reader = await pool.connect();

    try {
      const shared = await upload("Shared resume");
      const live = await upload("Keep this resume");
      const { rows: [saved] } = await reader.query(`
        SELECT id, user_id, object_key, extracted_text, parse_status FROM public.resumes WHERE id = $1
      `, [shared.id]);
      assert.deepEqual(saved, {
        id: shared.id, user_id: first.id, object_key: shared.objectKey,
        extracted_text: parsed.text, parse_status: "succeeded",
      });
      assert.deepEqual((await resumes.service.download(first.id, shared.id))?.bytes, new Uint8Array(bytes));

      await reader.query(`
        INSERT INTO public.applications (user_id, company_name, position_title, resume_id)
        VALUES ($1, 'Example Company', 'Developer', $2), ($1, 'Example Company', 'Engineer', $2)
      `, [first.id, shared.id]);
      assert.equal((await resumes.service.get(first.id, shared.id))?.linkedApplicationCount, 2);

      assert.deepEqual(await resumes.service.remove(first.id, shared.id), { unlinkedApplicationCount: 2 });
      const { rows: links } = await reader.query("SELECT resume_id, row_version FROM public.applications");
      assert.deepEqual(links, [{ resume_id: null, row_version: "2" }, { resume_id: null, row_version: "2" }]);
      assert.equal(await resumes.service.download(first.id, shared.id), null);
      assert.ok(storage.objects.has(shared.objectKey));

      const job = async (key: string) => (await reader.query(`
        SELECT reason, status, attempt_count, last_error_code, next_attempt_at > CURRENT_TIMESTAMP AS scheduled
        FROM public.storage_cleanup_jobs WHERE object_key = $1
      `, [key])).rows[0];
      assert.deepEqual(await job(shared.objectKey), {
        reason: "resume_deleted", status: "pending", attempt_count: 0, last_error_code: null, scheduled: false,
      });
      await reader.query(`
        INSERT INTO public.storage_cleanup_jobs (object_key, reason) VALUES ($1, 'upload_rollback')
      `, [live.objectKey]);

      storage.deleteError = new StorageError("timeout");
      await resumes.startWorker().stop();
      assert.deepEqual(await job(shared.objectKey), {
        reason: "resume_deleted", status: "pending", attempt_count: 1, last_error_code: "timeout", scheduled: true,
      });
      assert.ok(storage.objects.has(shared.objectKey));
      assert.ok(storage.objects.has(live.objectKey));
      assert.equal((await job(live.objectKey)).status, "done");

      // Make the persisted retry due before starting a fresh worker.
      await reader.query(`
        UPDATE public.storage_cleanup_jobs SET next_attempt_at = CURRENT_TIMESTAMP WHERE object_key = $1
      `, [shared.objectKey]);
      storage.deleteError = undefined;
      await createPostgresResumeModule(deps).startWorker().stop();
      assert.equal((await job(shared.objectKey)).status, "done");
      assert.equal(await storage.head(shared.objectKey), null);
      assert.deepEqual((await resumes.service.download(first.id, live.id))?.bytes, new Uint8Array(bytes));
      assert.deepEqual(storage.calls.filter((call) => call.startsWith("delete ")),
        [`delete ${shared.objectKey}`, `delete ${shared.objectKey}`]);
    } finally {
      reader.release();
    }
  }));
