import type { Db } from "../../src/modules/applications/repository.js";

export async function insertWorkspace(db: Db, applicationId: string): Promise<string> {
  const { rows: [{ id }] } = await db.query<{ id: string }>(
    "INSERT INTO public.ai_workspaces (application_id) VALUES ($1) RETURNING id", [applicationId],
  );
  return id;
}

export async function insertConversation(db: Db, workspaceId: string): Promise<string> {
  const { rows: [{ id }] } = await db.query<{ id: string }>(
    "INSERT INTO public.conversations (workspace_id) VALUES ($1) RETURNING id", [workspaceId],
  );
  return id;
}

export async function insertGeneration(db: Db, conversationId: string, sequence: number,
  status: "preparing" | "streaming" | "completed", baselineId: string | null = null): Promise<string> {
  const { rows: [input] } = await db.query<{ id: string }>(`
    INSERT INTO public.messages (conversation_id, sequence_no, role, parts)
    VALUES ($1, $2, 'user', '[{"type":"text","text":"Help me prepare"}]') RETURNING id
  `, [conversationId, sequence]);
  const { rows: [{ id }] } = await db.query<{ id: string }>(`
    INSERT INTO public.generation_runs (conversation_id, input_message_id, status, baseline_generation_id, snapshot_at, completed_at)
    VALUES ($1, $2, $3, $4,
      CASE WHEN $3 IN ('streaming', 'completed') THEN CURRENT_TIMESTAMP END,
      CASE WHEN $3 = 'completed' THEN CURRENT_TIMESTAMP END) RETURNING id
  `, [conversationId, input.id, status, baselineId]);
  return id;
}

export async function seedCompletedConversation(db: Db, applicationId: string, resumeId: string) {
  const workspaceId = await insertWorkspace(db, applicationId);
  const conversationId = await insertConversation(db, workspaceId);
  const generationId = await insertGeneration(db, conversationId, 1, "completed");
  await db.query(`
    INSERT INTO public.messages (conversation_id, generation_id, sequence_no, role, parts)
    VALUES ($1, $2, 2, 'assistant', '[{"type":"text","text":"Review the role requirements"}]')
  `, [conversationId, generationId]);
  const { rows: [snapshot] } = await db.query<{ id: string }>(`
    INSERT INTO public.material_snapshots (
      conversation_id, generation_id, kind, fingerprint, source_resume_id, source_label, availability, content_text
    ) VALUES ($1, $2, 'resume', $3, $4, 'Example resume', 'available', 'Historical resume text') RETURNING id
  `, [conversationId, generationId, `v1:${"a".repeat(64)}`, resumeId]);
  await db.query(`
    INSERT INTO public.generation_materials (generation_id, conversation_id, kind, snapshot_id)
    VALUES ($1, $2, 'resume', $3)
  `, [generationId, conversationId, snapshot.id]);
  await db.query(`
    INSERT INTO public.conversation_summaries (conversation_id, through_sequence_no, summary_text)
    VALUES ($1, 2, 'Reviewed the role requirements')
  `, [conversationId]);
  await db.query("UPDATE public.conversations SET next_sequence_no = 3 WHERE id = $1", [conversationId]);
  return { workspaceId, conversationId, generationId };
}
