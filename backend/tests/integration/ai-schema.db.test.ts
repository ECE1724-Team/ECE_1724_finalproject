import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { withTransaction } from "../../src/db/transaction.js";
import { createPostgresApplicationRepository } from "../../src/modules/applications/postgres-repository.js";
import { newApplication, savedApplication } from "../helpers/applications.js";
import { insertConversation, insertGeneration, insertWorkspace } from "../helpers/conversations.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

const applications = createPostgresApplicationRepository();

async function seedWorkspace(pool: Pool) {
  const { first } = await insertTestOwners(pool);
  const { id: applicationId } = savedApplication(await applications.insert(pool, newApplication(first.id)));
  const workspaceId = await insertWorkspace(pool, applicationId);
  return { applicationId, workspaceId };
}

test("an application has one workspace and that workspace can store two conversations", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { applicationId, workspaceId } = await seedWorkspace(pool);
  await assert.rejects(insertWorkspace(pool, applicationId), { code: "23505", constraint: "ai_workspaces_application_unique" });

  const first = await insertConversation(pool, workspaceId);
  const second = await insertConversation(pool, workspaceId);
  assert.notEqual(first, second);
  const workspaces = await pool.query("SELECT id FROM public.ai_workspaces WHERE application_id = $1", [applicationId]);
  const conversations = await pool.query("SELECT id FROM public.conversations WHERE workspace_id = $1 ORDER BY id", [workspaceId]);
  assert.deepEqual(workspaces.rows, [{ id: workspaceId }]);
  assert.deepEqual(conversations.rows, [first, second].sort().map((id) => ({ id })));
}));

test("the active generation index applies independently to each conversation", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { workspaceId } = await seedWorkspace(pool);
  const first = await insertConversation(pool, workspaceId);
  const second = await insertConversation(pool, workspaceId);
  const firstRun = await insertGeneration(pool, first, 1, "preparing");

  await assert.rejects(
    withTransaction(pool, (client) => insertGeneration(client, first, 2, "streaming")),
    { code: "23505", constraint: "generation_runs_one_active_idx" },
  );
  const secondRun = await insertGeneration(pool, second, 1, "preparing");
  const { rows } = await pool.query("SELECT id, conversation_id, status FROM public.generation_runs ORDER BY id");
  assert.deepEqual(rows, [
    { id: firstRun, conversation_id: first, status: "preparing" },
    { id: secondRun, conversation_id: second, status: "preparing" },
  ].sort((a, b) => a.id.localeCompare(b.id)));
}));

test("a generation material must reference a run and snapshot in the same conversation", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { workspaceId } = await seedWorkspace(pool);
  const first = await insertConversation(pool, workspaceId);
  const second = await insertConversation(pool, workspaceId);
  const firstRun = await insertGeneration(pool, first, 1, "completed");
  const secondRun = await insertGeneration(pool, second, 1, "completed");

  const insertSnapshot = async (conversationId: string, runId: string) => {
    const { rows: [{ id }] } = await pool.query<{ id: string }>(`
      INSERT INTO public.material_snapshots (conversation_id, generation_id, kind, fingerprint, availability, content_text)
      VALUES ($1, $2, 'jd', $3, 'available', $4) RETURNING id
    `, [conversationId, runId, `v1:${"a".repeat(64)}`, "Example job description"]);
    return id;
  };
  const firstSnapshot = await insertSnapshot(first, firstRun);
  const secondSnapshot = await insertSnapshot(second, secondRun);
  const associate = (conversationId: string, snapshotId: string) => pool.query(`
    INSERT INTO public.generation_materials (generation_id, conversation_id, kind, snapshot_id)
    VALUES ($1, $2, 'jd', $3)
  `, [firstRun, conversationId, snapshotId]);

  await assert.rejects(associate(first, secondSnapshot), { code: "23503", constraint: "generation_materials_snapshot_fk" });
  await assert.rejects(associate(second, secondSnapshot), { code: "23503", constraint: "generation_materials_generation_fk" });
  await associate(first, firstSnapshot);

  const { rows } = await pool.query("SELECT generation_id, conversation_id, kind, snapshot_id FROM public.generation_materials");
  assert.deepEqual(rows, [{ generation_id: firstRun, conversation_id: first, kind: "jd", snapshot_id: firstSnapshot }]);
}));
