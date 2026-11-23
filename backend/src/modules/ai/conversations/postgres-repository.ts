import type { Pool } from "pg";
import type { Db } from "../../../db/pool.js";
import { withTransaction } from "../../../db/transaction.js";
import type { Availability } from "../context/materials.js";

// Database Design §5.6, §5.8–5.9, §8.4. Ownership always resolves conversation -> workspace ->
// application -> user. Reads never refresh materials or start a generation.

/** A saved snapshot fixed for a generation (endpoints.json AiMaterialReference). */
export interface MaterialReference {
  kind: string;
  fingerprint: string;
  availability: Availability;
  sourceResumeId: string | null;
  reasonCode: string | null;
  snapshotId: string;
}

export interface ConversationView {
  id: string;
  workspaceId: string;
  title: string | null;
  activeGenerationId: string | null;
  /** The baseline: snapshots behind the latest completed answer, keyed by kind. */
  materialState: Record<string, MaterialReference>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageView {
  id: string;
  conversationId: string;
  generationId: string | null;
  /** PostgreSQL bigint as a decimal string. */
  sequenceNo: string;
  role: "user" | "assistant" | "tool";
  parts: unknown[];
  createdAt: Date;
}

export interface SnapshotView extends Omit<MaterialReference, "snapshotId"> {
  id: string;
  conversationId: string;
  generationId: string;
  sourceLabel: string | null;
  contentText: string | null;
  createdAt: Date;
}

const OWNED_CONVERSATION = `
  FROM public.conversations c
  JOIN public.ai_workspaces w ON w.id = c.workspace_id
  JOIN public.applications a ON a.id = w.application_id
  WHERE a.user_id = $1`;

const CONVERSATION_FIELDS = `c.id, c.workspace_id AS "workspaceId", c.title,
  c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  (SELECT g.id FROM public.generation_runs g
   WHERE g.conversation_id = c.id AND g.status IN ('preparing', 'streaming')) AS "activeGenerationId"`;

export const SNAPSHOT_REFERENCE_FIELDS = `s.kind, s.id AS "snapshotId", s.fingerprint, s.availability,
  s.source_resume_id AS "sourceResumeId", s.reason_code AS "reasonCode"`;

/** The authorized conversation and its application, or null. `lock` takes the conversation row lock. */
export async function findConversation(db: Db, userId: string, conversationId: string, lock = false) {
  const { rows: [row] } = await db.query<{ id: string; applicationId: string }>(`
    SELECT c.id, w.application_id AS "applicationId" ${OWNED_CONVERSATION} AND c.id = $2
    ${lock ? "FOR UPDATE OF c" : ""}
  `, [userId, conversationId]);
  return row ?? null;
}

/** Baseline references (§8.4) for each conversation that has a completed generation. */
export async function readBaselines(db: Db, conversationIds: string[]) {
  const { rows } = await db.query<MaterialReference & { conversationId: string; generationId: string; sourceLabel: string | null }>(`
    WITH latest AS (
      SELECT DISTINCT ON (g.conversation_id) g.conversation_id, g.id
      FROM public.generation_runs g
      WHERE g.conversation_id = ANY($1::uuid[]) AND g.status = 'completed'
      ORDER BY g.conversation_id, g.completed_at DESC, g.id DESC
    )
    SELECT l.conversation_id AS "conversationId", l.id AS "generationId",
           ${SNAPSHOT_REFERENCE_FIELDS}, s.source_label AS "sourceLabel"
    FROM latest l
    JOIN public.generation_materials gm ON gm.generation_id = l.id
    JOIN public.material_snapshots s
      ON s.id = gm.snapshot_id AND s.conversation_id = gm.conversation_id AND s.kind = gm.kind
  `, [conversationIds]);
  return rows;
}

async function withMaterialState(db: Db, rows: Omit<ConversationView, "materialState">[]): Promise<ConversationView[]> {
  const baselines = await readBaselines(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const materialState: ConversationView["materialState"] = {};
    for (const { conversationId, generationId: _g, sourceLabel: _l, ...reference } of baselines) {
      if (conversationId === row.id) materialState[reference.kind] = reference;
    }
    return { ...row, materialState };
  });
}

/** The owned workspace's conversations, most recently updated first; null when not owned. */
export async function listConversations(db: Db, userId: string, workspaceId: string): Promise<ConversationView[] | null> {
  const { rows: [workspace] } = await db.query(`
    SELECT 1 FROM public.ai_workspaces w JOIN public.applications a ON a.id = w.application_id
    WHERE w.id = $1 AND a.user_id = $2
  `, [workspaceId, userId]);
  if (!workspace) return null;
  const { rows } = await db.query<Omit<ConversationView, "materialState">>(`
    SELECT ${CONVERSATION_FIELDS} ${OWNED_CONVERSATION} AND c.workspace_id = $2
    ORDER BY c.updated_at DESC, c.id
  `, [userId, workspaceId]);
  return withMaterialState(db, rows);
}

/** An empty conversation with a null title. null when the workspace is not the user's. */
export async function createConversation(db: Db, userId: string, workspaceId: string): Promise<ConversationView | null> {
  const { rows: [row] } = await db.query<Omit<ConversationView, "materialState" | "activeGenerationId">>(`
    INSERT INTO public.conversations AS c (workspace_id)
    SELECT w.id FROM public.ai_workspaces w JOIN public.applications a ON a.id = w.application_id
    WHERE w.id = $1 AND a.user_id = $2
    RETURNING c.id, c.workspace_id AS "workspaceId", c.title, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
  `, [workspaceId, userId]);
  return row ? { ...row, activeGenerationId: null, materialState: {} } : null;
}

export async function getConversation(db: Db, userId: string, conversationId: string): Promise<ConversationView | null> {
  const { rows } = await db.query<Omit<ConversationView, "materialState">>(`
    SELECT ${CONVERSATION_FIELDS} ${OWNED_CONVERSATION} AND c.id = $2
  `, [userId, conversationId]);
  if (!rows.length) return null;
  const [conversation] = await withMaterialState(db, rows);
  return conversation;
}

/** Sets the display title; null when the conversation is not the user's. Not activity, so the list order stays. */
export async function renameConversation(db: Db, userId: string, conversationId: string, title: string)
  : Promise<ConversationView | null> {
  const { rowCount } = await db.query(`
    UPDATE public.conversations c SET title = $3
    FROM public.ai_workspaces w JOIN public.applications a ON a.id = w.application_id
    WHERE c.id = $2 AND w.id = c.workspace_id AND a.user_id = $1
  `, [userId, conversationId, title]);
  return rowCount ? getConversation(db, userId, conversationId) : null;
}

/** Full stored history in numeric sequence order; null when the conversation is not the user's. */
export async function listMessages(db: Db, userId: string, conversationId: string): Promise<MessageView[] | null> {
  if (!(await findConversation(db, userId, conversationId))) return null;
  const { rows } = await db.query<MessageView>(`
    SELECT id, conversation_id AS "conversationId", generation_id AS "generationId",
           sequence_no::text AS "sequenceNo", role, parts, created_at AS "createdAt"
    FROM public.messages WHERE conversation_id = $1
    ORDER BY sequence_no
  `, [conversationId]);
  return rows;
}

/**
 * A saved snapshot, read only through its own conversation. Snapshots of a deleted resume stay
 * readable here as history; they never authorize reading the current resume or its file.
 */
export async function getSnapshot(db: Db, userId: string, conversationId: string, snapshotId: string): Promise<SnapshotView | null> {
  const { rows: [row] } = await db.query<SnapshotView>(`
    SELECT s.id, s.conversation_id AS "conversationId", s.generation_id AS "generationId", s.kind,
           s.fingerprint, s.availability, s.source_resume_id AS "sourceResumeId", s.reason_code AS "reasonCode",
           s.source_label AS "sourceLabel", s.content_text AS "contentText", s.created_at AS "createdAt"
    FROM public.material_snapshots s
    JOIN public.conversations c ON c.id = s.conversation_id
    JOIN public.ai_workspaces w ON w.id = c.workspace_id
    JOIN public.applications a ON a.id = w.application_id
    WHERE a.user_id = $1 AND s.conversation_id = $2 AND s.id = $3
  `, [userId, conversationId, snapshotId]);
  return row ?? null;
}

export interface SummaryView {
  id: string;
  throughSequenceNo: number;
  text: string;
}

/**
 * The conversation's newest internal summary, or with `beforeSequenceNo` the newest one whose
 * boundary precedes that message. Summaries are internal and never returned by the API.
 */
export async function latestSummary(db: Db, conversationId: string, beforeSequenceNo: number | null = null)
  : Promise<SummaryView | null> {
  const { rows: [row] } = await db.query<{ id: string; throughSequenceNo: string; text: string }>(`
    SELECT id, through_sequence_no::text AS "throughSequenceNo", summary_text AS text
    FROM public.conversation_summaries
    WHERE conversation_id = $1 AND ($2::bigint IS NULL OR through_sequence_no < $2)
    ORDER BY through_sequence_no DESC LIMIT 1
  `, [conversationId, beforeSequenceNo]);
  return row ? { ...row, throughSequenceNo: Number(row.throughSequenceNo) } : null;
}

/**
 * Saves a summary generated outside any transaction. Under the conversation lock, the newest summary
 * must still be the one it extended and the boundary must advance past it; otherwise nothing is
 * saved and false is returned.
 */
export function saveSummary(pool: Pool, conversationId: string, previousSummaryId: string | null,
  throughSequenceNo: number, text: string): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT id FROM public.conversations WHERE id = $1 FOR UPDATE", [conversationId]);
    const latest = await latestSummary(client, conversationId);
    if ((latest?.id ?? null) !== previousSummaryId || throughSequenceNo <= (latest?.throughSequenceNo ?? 0)) return false;
    await client.query(`
      INSERT INTO public.conversation_summaries (conversation_id, through_sequence_no, summary_text, previous_summary_id)
      VALUES ($1, $2, $3, $4)
    `, [conversationId, throughSequenceNo, text, previousSummaryId]);
    return true;
  });
}
