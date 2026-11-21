import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";
import { DEFAULT_HISTORY_LIMITS } from "../../src/modules/ai/context/history.js";
import type { PromptMessage } from "../../src/modules/ai/context/prompt.js";
import { createConversation, getConversation, getSnapshot } from "../../src/modules/ai/conversations/postgres-repository.js";
import { acceptInput, completeGeneration, endGeneration, type PreparedTurn } from "../../src/modules/ai/generations/postgres-repository.js";
import { prepareTurn } from "../../src/modules/ai/generations/service.js";
import { ensureWorkspace } from "../../src/modules/ai/workspaces/postgres-repository.js";
import { createPostgresApplicationRepository } from "../../src/modules/applications/postgres-repository.js";
import type { ApplicationUpdate } from "../../src/modules/applications/repository.js";
import { FakeLlm } from "../fakes/llm.js";
import { newApplication, resumes, savedApplication } from "../helpers/applications.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

const applications = createPostgresApplicationRepository();
// No turn here reaches the compression threshold, so the model is never called.
const history = { limits: DEFAULT_HISTORY_LIMITS, model: new FakeLlm().chatModel(), signal: new AbortController().signal };

async function addResume(pool: Pool, userId: string, name: string, text: string | null) {
  const id = randomUUID();
  return resumes.insert(pool, {
    id, userId, name, originalFilename: `${name}.pdf`, objectKey: `resumes/${id}.pdf`, sizeBytes: 256, pageCount: 1,
    ...(text === null
      ? { parseStatus: "text_unavailable", nonWhitespaceChars: 0, extractedText: null }
      : { parseStatus: "succeeded", nonWhitespaceChars: 120, extractedText: text }),
  });
}

/** One user with an application linked to resume V1, its workspace and a fake model. */
async function setup(pool: Pool) {
  const { first: owner, second: stranger } = await insertTestOwners(pool);
  const v1 = await addResume(pool, owner.id, "SWE_Resume_v1", "Built a payments API.");
  const application = savedApplication(await applications.insert(pool, newApplication(owner.id, {
    companyName: "Acme", positionTitle: "Backend Engineer", jobDescription: "Build APIs in Go.", resumeId: v1.id,
  })));
  const workspace = (await ensureWorkspace(pool, owner.id, application.id))!;
  const modelCalls: PromptMessage[][] = [];

  const newConversation = async () => (await createConversation(pool, owner.id, workspace.id))!.id;
  const edit = async (changes: ApplicationUpdate) =>
    savedApplication(await applications.update(pool, owner.id, application.id, undefined, changes));
  /** Accepts and prepares a turn; the fake model runs only if preparation succeeded. */
  const start = async (conversationId: string, content: string) => {
    const accepted = await acceptInput(pool, owner.id, conversationId, content);
    assert.equal(accepted.outcome, "ACCEPTED");
    const ready = await prepareTurn(pool, owner.id, conversationId, accepted.generationId, history);
    assert.ok(ready);
    modelCalls.push(ready.prompt);
    const finish = async () => {
      assert.ok(await completeGeneration(pool, conversationId, accepted.generationId, `Reply to: ${content}`));
    };
    return { ...ready.prepared, prompt: ready.prompt, finish };
  };
  const turn = async (conversationId: string, content: string) => {
    const started = await start(conversationId, content);
    await started.finish();
    return started;
  };
  return { owner, stranger, v1, application, workspace, modelCalls, newConversation, edit, start, turn };
}

const materialOf = (turn: PreparedTurn, kind: string) => turn.materials.find((m) => m.kind === kind)!;
const context = (turn: { prompt: PromptMessage[] }) => turn.prompt[1].content;
const countRows = async (pool: Pool, table: "material_snapshots" | "generation_materials" | "messages") =>
  (await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.${table}`)).rows[0].count;

test("each turn fixes fingerprinted snapshots and reuses unchanged versions", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { owner, stranger, v1, workspace, newConversation, edit, turn } = await setup(pool);
  const conversationId = await newConversation();

  // First turn: everything is new, but there is no baseline to contrast, so no notice.
  const first = await turn(conversationId, "Review my resume. Focus on impact.");
  assert.equal(first.baselineGenerationId, null);
  assert.deepEqual(first.changedKinds, ["resume", "jd", "company", "position", "company_website_url", "company_notes"]);
  assert.doesNotMatch(context(first), /material_changes/);
  assert.equal(await countRows(pool, "material_snapshots"), 6);
  // The workspace view and turn preparation read the same materials and fingerprints.
  for (const [kind, version] of Object.entries(workspace.materials)) {
    assert.equal(materialOf(first, kind).fingerprint, version.fingerprint);
  }
  const conversation = (await getConversation(pool, owner.id, conversationId))!;
  assert.equal(conversation.title, "Review my resume.");
  assert.equal(conversation.activeGenerationId, null);
  assert.deepEqual(Object.values(conversation.materialState).map((m) => m.snapshotId).sort(),
    first.materials.map((m) => m.snapshotId).sort());

  // An edit reverted before the next turn is no change: same snapshots, no notice.
  await edit({ jobDescription: "Build APIs in Rust." });
  await edit({ jobDescription: "Build APIs in Go." });
  const reverted = await turn(conversationId, "Thanks.");
  assert.equal(reverted.baselineGenerationId, first.generationId);
  assert.deepEqual(reverted.changedKinds, []);
  assert.deepEqual(reverted.materials.map((m) => m.snapshotId), first.materials.map((m) => m.snapshotId));
  assert.equal(await countRows(pool, "material_snapshots"), 6);
  assert.equal(await countRows(pool, "generation_materials"), 12);

  // Another resume with identical text is still a different version.
  const copy = await addResume(pool, owner.id, "SWE_Resume_copy", "Built a payments API.");
  await edit({ resumeId: copy.id });
  const copied = await turn(conversationId, "Use my new file.");
  assert.deepEqual(copied.changedKinds, ["resume"]);
  assert.match(context(copied), /- Resume changed from "SWE_Resume_v1" to "SWE_Resume_copy"\./);
  assert.equal(copied.prompt[3].content, '[based on earlier materials: resume "SWE_Resume_v1"]\nReply to: Review my resume. Focus on impact.');
  assert.equal(copied.prompt.at(-1)!.content, "Use my new file.");

  // A missing JD and a scanned resume are saved as distinct known absences; chat continues.
  const scan = await addResume(pool, owner.id, "Scanned", null);
  await edit({ jobDescription: null, resumeId: scan.id });
  const limited = await turn(conversationId, "What can you see?");
  assert.deepEqual(limited.changedKinds, ["resume", "jd"]);
  const { rows: absent } = await pool.query(`
    SELECT kind, availability, reason_code, source_resume_id, source_label, content_text
    FROM public.material_snapshots WHERE id = ANY($1::uuid[]) ORDER BY kind
  `, [[materialOf(limited, "resume").snapshotId, materialOf(limited, "jd").snapshotId]]);
  assert.deepEqual(absent, [
    { kind: "jd", availability: "unavailable", reason_code: "FIELD_MISSING", source_resume_id: null, source_label: null, content_text: null },
    { kind: "resume", availability: "unavailable", reason_code: "RESUME_TEXT_UNAVAILABLE", source_resume_id: scan.id, source_label: "Scanned", content_text: null },
  ]);

  // Unlinking is a change; relinking V1 reuses its original snapshot.
  await edit({ resumeId: null });
  const unlinked = await turn(conversationId, "And now?");
  assert.equal(materialOf(unlinked, "resume").reasonCode, "RESUME_NOT_LINKED");
  await edit({ resumeId: v1.id });
  const relinked = await turn(conversationId, "Back to V1.");
  const v1Snapshot = materialOf(first, "resume").snapshotId;
  assert.equal(materialOf(relinked, "resume").snapshotId, v1Snapshot);

  // Deleting V1 unlinks it; the next turn reuses the not-linked snapshot, and V1's text stays
  // readable as history through this conversation only.
  const snapshotsBefore = await countRows(pool, "material_snapshots");
  assert.deepEqual(await resumes.deleteAndUnlink(pool, owner.id, v1.id), { unlinkedApplicationCount: 1 });
  const deleted = await turn(conversationId, "I deleted it.");
  assert.equal(materialOf(deleted, "resume").snapshotId,
    materialOf(unlinked, "resume").snapshotId);
  assert.equal(await countRows(pool, "material_snapshots"), snapshotsBefore);
  const history = await getSnapshot(pool, owner.id, conversationId, v1Snapshot);
  assert.equal(history?.contentText, "Built a payments API.");
  assert.equal(history?.sourceResumeId, v1.id);
  assert.equal(await getSnapshot(pool, stranger.id, conversationId, v1Snapshot), null);
  assert.equal(await getSnapshot(pool, owner.id, await newConversation(), v1Snapshot), null);
}));

test("a switch during generation affects later turns only, and each conversation refreshes on its own", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { owner, newConversation, edit, start, turn } = await setup(pool);
  const a = await newConversation();
  const b = await newConversation();
  await turn(a, "Hello A");
  const bFirst = await turn(b, "Hello B");

  // V1 is fixed when A's turn is prepared; switching to V2 mid-generation does not change it.
  const inFlight = await start(a, "Mock interview please.");
  assert.equal((await acceptInput(pool, owner.id, a, "Second send")).outcome, "GENERATION_ACTIVE");
  const v2 = await addResume(pool, owner.id, "SWE_Resume_v2", "Led a team of four.");
  await edit({ resumeId: v2.id });
  await inFlight.finish();
  assert.match(context(inFlight), /Built a payments API\./);
  const { rows: [used] } = await pool.query(`
    SELECT s.content_text FROM public.generation_materials gm JOIN public.material_snapshots s ON s.id = gm.snapshot_id
    WHERE gm.generation_id = $1 AND gm.kind = 'resume'
  `, [inFlight.generationId]);
  assert.equal(used.content_text, "Built a payments API.");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.messages WHERE parts->0->>'text' = 'Second send'")).rows[0].n, 0);

  const aNext = await turn(a, "Next question.");
  assert.deepEqual(aNext.changedKinds, ["resume"]);
  assert.match(context(aNext), /Led a team of four\./);
  assert.doesNotMatch(context(aNext), /Built a payments API/);

  // B has not had a turn since the switch: its baseline still shows V1.
  const bState = (await getConversation(pool, owner.id, b))!.materialState;
  assert.equal(bState.resume.snapshotId, materialOf(bFirst, "resume").snapshotId);

  // A failed attempt does not advance B's baseline, so the next attempt repeats the notice.
  const failed = await start(b, "Review V2.");
  assert.deepEqual(failed.changedKinds, ["resume"]);
  assert.ok(await endGeneration(pool, b, failed.generationId, "failed", "GENERATION_FAILED"));
  const bNext = await turn(b, "Review V2 again.");
  assert.equal(bNext.baselineGenerationId, bFirst.generationId);
  assert.deepEqual(bNext.changedKinds, ["resume"]);
  assert.match(context(bNext), /- Resume changed from "SWE_Resume_v1" to "SWE_Resume_v2"\./);
  // The failed attempt's snapshot is reused, and its unanswered input is left out of the history.
  assert.equal(materialOf(bNext, "resume").snapshotId, materialOf(failed, "resume").snapshotId);
  assert.deepEqual(bNext.prompt.slice(2).map((m) => m.content), ["Hello B", `[based on earlier materials: resume "SWE_Resume_v1"]\nReply to: Hello B`, "Review V2 again."]);
}));

test("a material read or snapshot write failure rolls back preparation and makes no model call", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { owner, modelCalls, newConversation, turn } = await setup(pool);
  const conversationId = await newConversation();

  const expectRefreshFailure = async (content: string) => {
    const accepted = await acceptInput(pool, owner.id, conversationId, content);
    assert.equal(accepted.outcome, "ACCEPTED");
    await assert.rejects(prepareTurn(pool, owner.id, conversationId, accepted.generationId, history));
    const { rows: [run] } = await pool.query("SELECT status, error_code, snapshot_at FROM public.generation_runs WHERE id = $1", [accepted.generationId]);
    assert.deepEqual(run, { status: "failed", error_code: "MATERIAL_REFRESH_FAILED", snapshot_at: null });
    const { rows: [input] } = await pool.query("SELECT parts->0->>'text' AS text FROM public.messages WHERE id = $1", [accepted.inputMessage.id]);
    assert.equal(input.text, content, "the accepted input is kept for a retry");
  };

  // Snapshot write failure.
  await pool.query(`
    CREATE FUNCTION fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
    CREATE TRIGGER fail_snapshot BEFORE INSERT ON public.material_snapshots FOR EACH ROW EXECUTE FUNCTION fail_snapshot();
  `);
  await expectRefreshFailure("First try");
  await pool.query("DROP TRIGGER fail_snapshot ON public.material_snapshots");

  // Material read failure.
  await pool.query("ALTER TABLE public.applications RENAME COLUMN company_notes TO company_notes_hidden");
  await expectRefreshFailure("Second try");
  await pool.query("ALTER TABLE public.applications RENAME COLUMN company_notes_hidden TO company_notes");

  assert.equal(modelCalls.length, 0);
  assert.equal(await countRows(pool, "material_snapshots"), 0);
  assert.equal(await countRows(pool, "generation_materials"), 0);

  // The conversation is free again and the next turn starts from no baseline.
  const recovered = await turn(conversationId, "Third try");
  assert.equal(recovered.baselineGenerationId, null);
  assert.equal(recovered.materials.length, 6);
  assert.equal(modelCalls.length, 1);
}));
