import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";
import { withTransaction } from "../../src/db/transaction.js";
import { createPostgresApplicationRepository, createPostgresInterviewRepository } from "../../src/modules/applications/postgres-repository.js";
import { insertResume, newApplication, resumes, savedApplication } from "../helpers/applications.js";
import { insertConversation, insertGeneration, insertWorkspace, seedCompletedConversation } from "../helpers/conversations.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";
import { waitForBlockedQuery, withLockHolder } from "../helpers/lock-race.js";

const applications = createPostgresApplicationRepository();
const interviews = createPostgresInterviewRepository();

const TABLES = [
  "applications", "interviews", "application_status_history", "ai_workspaces", "conversations",
  "messages", "generation_runs", "material_snapshots", "generation_materials", "conversation_summaries",
  "resumes", "storage_cleanup_jobs",
];

async function snapshot(pool: Pool) {
  const entries = await Promise.all(TABLES.map(async (table) => {
    const { rows } = await pool.query(`SELECT t.* FROM public.${table} t ORDER BY to_jsonb(t)`);
    return [table, rows] as const;
  }));
  return Object.fromEntries(entries);
}

test("hard deletion rejects both active statuses and cascades completed conversation graphs only for the target", () =>
  withTestDatabase(async ({ pool, migrate }) => {
    await migrate();
    const { first, second } = await insertTestOwners(pool);
    const userId = first.id;
    const resume = await insertResume(pool, userId);
    const sibling = savedApplication(await applications.insert(pool, newApplication(userId, { resumeId: resume.id })));
    await seedCompletedConversation(pool, sibling.id, resume.id);
    const siblingRows = await snapshot(pool);

    const target = savedApplication(await applications.insert(pool, newApplication(userId, { resumeId: resume.id })));
    await interviews.insert(pool, {
      id: randomUUID(), userId, applicationId: target.id, interviewName: "Screen", startsAt: new Date(),
    });
    savedApplication(await applications.update(pool, userId, target.id, target.rowVersion, { status: "interview" }));
    const graph = await seedCompletedConversation(pool, target.id, resume.id);
    let sequence = 3;
    for (const status of ["preparing", "streaming"] as const) {
      const runId = await insertGeneration(pool, graph.conversationId, sequence++, status, graph.generationId);
      const before = await snapshot(pool);
      assert.equal(await applications.delete(pool, second.id, target.id), "NOT_FOUND");
      assert.equal(await applications.delete(pool, userId, target.id), "GENERATION_ACTIVE");
      assert.deepEqual(await snapshot(pool), before);
      await pool.query("UPDATE public.generation_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = $1", [runId]);
    }
    assert.equal(await applications.delete(pool, userId, target.id), "DELETED");
    assert.deepEqual(await snapshot(pool), siblingRows);
    assert.equal(await applications.delete(pool, userId, target.id), "NOT_FOUND");

    // Deleting the library item later preserves the surviving conversation's recorded text.
    assert.deepEqual(await resumes.deleteAndUnlink(pool, userId, resume.id), { unlinkedApplicationCount: 1 });
    const afterResumeDelete = await snapshot(pool);
    assert.deepEqual(afterResumeDelete.material_snapshots, siblingRows.material_snapshots);
    assert.deepEqual(afterResumeDelete.generation_materials, siblingRows.generation_materials);
    assert.equal(afterResumeDelete.resumes[0].extracted_text, null);
  }));

test("hard deletion also removes interviews and history for an application without a workspace", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first } = await insertTestOwners(pool);
  const userId = first.id;
  const before = await snapshot(pool);
  const target = savedApplication(await applications.insert(pool, newApplication(userId)));
  await interviews.insert(pool, { id: randomUUID(), userId, applicationId: target.id, interviewName: "Round", startsAt: new Date() });
  savedApplication(await applications.update(pool, userId, target.id, target.rowVersion, { status: "interview" }));
  assert.equal(await applications.delete(pool, userId, target.id), "DELETED");
  assert.deepEqual(await snapshot(pool), before);
}));

test("deletion waits for a generation accepting input and sees the committed active run", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first: { id: userId } } = await insertTestOwners(pool);
  const { id } = savedApplication(await applications.insert(pool, newApplication(userId)));
  const workspace = await insertWorkspace(pool, id);
  const conversation = await insertConversation(pool, workspace);

  await withTransaction(pool, async (reader) => {
    const { run, deletion } = await withLockHolder(pool, async (holder, pid, start) => {
      await holder.query("SELECT id FROM public.conversations WHERE id = $1 FOR UPDATE", [conversation]);
      const run = await insertGeneration(holder, conversation, 1, "preparing");
      const deletion = start(applications.delete(pool, userId, id));
      await waitForBlockedQuery(pool, pid, "FROM public.conversations");
      return { run, deletion };
    });
    assert.equal(await deletion, "GENERATION_ACTIVE");
    assert.ok(await applications.get(reader, userId, id));
    const { rows } = await reader.query("SELECT status FROM public.generation_runs WHERE id = $1", [run]);
    assert.deepEqual(rows, [{ status: "preparing" }]);
  });
}));

test("a new conversation waits once deletion holds the workspace and cannot survive it", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first: { id: userId } } = await insertTestOwners(pool);
  const { id } = savedApplication(await applications.insert(pool, newApplication(userId)));
  const workspace = await insertWorkspace(pool, id);
  const conversation = await insertConversation(pool, workspace);

  await withTransaction(pool, async (reader) => {
    const { deletion, creation } = await withLockHolder(pool, async (holder, pid, start) => {
      await holder.query("SELECT id FROM public.conversations WHERE id = $1 FOR UPDATE", [conversation]);
      const deletion = start(applications.delete(pool, userId, id));
      const deleter = await waitForBlockedQuery(pool, pid, "FROM public.conversations");
      const creation = start(assert.rejects(insertConversation(pool, workspace), { code: "23503" }));
      await waitForBlockedQuery(pool, deleter, "INSERT INTO public.conversations");
      return { deletion, creation };
    });
    assert.equal(await deletion, "DELETED");
    await creation;
    assert.equal(await applications.get(reader, userId, id), null);
    assert.deepEqual((await reader.query("SELECT id FROM public.ai_workspaces")).rows, []);
    assert.deepEqual((await reader.query("SELECT id FROM public.conversations")).rows, []);
  });
}));

test("deletion waits on the application lock and checks a workspace created while it waits", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first: { id: userId } } = await insertTestOwners(pool);
  const { id } = savedApplication(await applications.insert(pool, newApplication(userId)));

  await withTransaction(pool, async (reader) => {
    const { deletion, workspace, run } = await withLockHolder(pool, async (holder, pid, start) => {
      await holder.query("SELECT id FROM public.applications WHERE id = $1 FOR UPDATE", [id]);
      const deletion = start(applications.delete(pool, userId, id));
      await waitForBlockedQuery(pool, pid, "FROM public.applications");
      const workspace = await insertWorkspace(holder, id);
      const conversation = await insertConversation(holder, workspace);
      const run = await insertGeneration(holder, conversation, 1, "preparing");
      return { deletion, workspace, run };
    });
    assert.equal(await deletion, "GENERATION_ACTIVE");
    assert.ok(await applications.get(reader, userId, id));
    assert.deepEqual((await reader.query("SELECT id FROM public.ai_workspaces WHERE application_id = $1", [id])).rows, [{ id: workspace }]);
    assert.deepEqual((await reader.query("SELECT status FROM public.generation_runs WHERE id = $1", [run])).rows, [{ status: "preparing" }]);
  });
}));
