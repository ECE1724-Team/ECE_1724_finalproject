import type { Pool } from "pg";
import type { Db } from "../../../db/pool.js";
import { withTransaction } from "../../../db/transaction.js";
import { changedKinds, currentMaterials, readMaterialSource } from "../context/materials.js";
import type { FixedMaterial, HistoryEntry, MaterialVersion } from "../context/prompt.js";
import { findConversation, readBaselines, type MessageView } from "../conversations/postgres-repository.js";

// The short turn transactions of Database Design §7.4. Each opens and commits its own transaction;
// model calls and network writes happen between them, never inside. Any transaction that needs
// both locks takes the conversation lock before the run lock.

export type AcceptResult =
  | { outcome: "ACCEPTED"; generationId: string; inputMessage: MessageView }
  | { outcome: "NOT_FOUND" | "GENERATION_ACTIVE" };

export interface PreparedTurn {
  generationId: string;
  inputMessageId: string;
  snapshotAt: Date;
  baselineGenerationId: string | null;
  /** One fixed snapshot per registered kind, in registry order. */
  materials: (FixedMaterial & { snapshotId: string; sourceResumeId: string | null })[];
  /** The baseline's versions keyed by kind; null when the conversation has no completed answer. */
  baseline: Record<string, MaterialVersion> | null;
  changedKinds: string[];
}

const MESSAGE_FIELDS = `id, conversation_id AS "conversationId", generation_id AS "generationId",
  sequence_no::text AS "sequenceNo", role, parts, created_at AS "createdAt"`;

/** The opening sentence of the first message, shortened for the conversation list. */
export function deriveTitle(content: string): string | null {
  const sentence = content.trim().split(/(?<=[.!?。！？])\s|\n/)[0].trim();
  if (!sentence) return null;
  const chars = [...sentence];
  return chars.length > 80 ? `${chars.slice(0, 79).join("").trimEnd()}…` : sentence;
}

async function allocateSequence(db: Db, conversationId: string, title: string | null = null): Promise<string> {
  const { rows: [row] } = await db.query<{ sequenceNo: string }>(`
    UPDATE public.conversations
    SET next_sequence_no = next_sequence_no + 1, title = COALESCE(title, $2), updated_at = statement_timestamp()
    WHERE id = $1
    RETURNING (next_sequence_no - 1)::text AS "sequenceNo"
  `, [conversationId, title]);
  return row.sequenceNo;
}

/**
 * Step 1: lock the conversation, save the user input and its `preparing` attempt. A conversation
 * with an active run rejects the input without saving anything.
 */
export function acceptInput(pool: Pool, userId: string, conversationId: string, content: string): Promise<AcceptResult> {
  return withTransaction(pool, async (client) => {
    if (!(await findConversation(client, userId, conversationId, true))) return { outcome: "NOT_FOUND" };
    const { rows: [active] } = await client.query(`
      SELECT 1 FROM public.generation_runs WHERE conversation_id = $1 AND status IN ('preparing', 'streaming')
    `, [conversationId]);
    if (active) return { outcome: "GENERATION_ACTIVE" };

    const sequenceNo = await allocateSequence(client, conversationId, deriveTitle(content));
    const { rows: [inputMessage] } = await client.query<MessageView>(`
      INSERT INTO public.messages (conversation_id, sequence_no, role, parts)
      VALUES ($1, $2, 'user', $3) RETURNING ${MESSAGE_FIELDS}
    `, [conversationId, sequenceNo, JSON.stringify([{ type: "text", text: content }])]);
    const { rows: [run] } = await client.query<{ id: string }>(`
      INSERT INTO public.generation_runs (conversation_id, input_message_id) VALUES ($1, $2) RETURNING id
    `, [conversationId, inputMessage.id]);
    return { outcome: "ACCEPTED", generationId: run.id, inputMessage };
  });
}

/**
 * Steps 2–4: in one repeatable-read snapshot, read every registered material, reuse or save its
 * snapshot, link one snapshot per kind to the run, record the baseline and mark the run streaming.
 * Returns null if the run is no longer preparing. A thrown error rolls all of it back.
 */
export function prepareMaterials(pool: Pool, userId: string, conversationId: string, generationId: string): Promise<PreparedTurn | null> {
  return withTransaction(pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const conversation = await findConversation(client, userId, conversationId, true);
    if (!conversation) return null;
    const { rows: [run] } = await client.query<{ status: string; inputMessageId: string }>(`
      SELECT status, input_message_id AS "inputMessageId" FROM public.generation_runs
      WHERE id = $1 AND conversation_id = $2 FOR UPDATE
    `, [generationId, conversationId]);
    if (run?.status !== "preparing") return null;

    const source = await readMaterialSource(client, conversation.applicationId);
    if (!source) return null;
    const current = currentMaterials(source);
    const baselineRows = await readBaselines(client, [conversationId]);
    const baseline = baselineRows.length ? Object.fromEntries(baselineRows.map((row) => [row.kind, row])) : null;

    const materials: PreparedTurn["materials"] = [];
    for (const material of current) {
      // Reuse this conversation's snapshot of the same version, including one saved by a failed attempt.
      const { rows: [existing] } = await client.query<{ id: string }>(`
        SELECT id FROM public.material_snapshots WHERE conversation_id = $1 AND kind = $2 AND fingerprint = $3
      `, [conversationId, material.kind, material.fingerprint]);
      const snapshotId = existing?.id ?? (await client.query<{ id: string }>(`
        INSERT INTO public.material_snapshots (
          conversation_id, generation_id, kind, fingerprint, source_resume_id, source_label,
          availability, content_text, reason_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
      `, [conversationId, generationId, material.kind, material.fingerprint, material.sourceResumeId,
        material.sourceLabel, material.availability, material.contentText, material.reasonCode])).rows[0].id;
      await client.query(`
        INSERT INTO public.generation_materials (generation_id, conversation_id, kind, snapshot_id) VALUES ($1, $2, $3, $4)
      `, [generationId, conversationId, material.kind, snapshotId]);
      materials.push({ ...material, snapshotId });
    }

    const baselineGenerationId = baselineRows[0]?.generationId ?? null;
    const { rows: [prepared] } = await client.query<{ snapshotAt: Date }>(`
      UPDATE public.generation_runs
      SET status = 'streaming', snapshot_at = statement_timestamp(), baseline_generation_id = $3
      WHERE id = $1 AND conversation_id = $2 AND status = 'preparing'
      RETURNING snapshot_at AS "snapshotAt"
    `, [generationId, conversationId, baselineGenerationId]);
    return {
      generationId, inputMessageId: run.inputMessageId, snapshotAt: prepared.snapshotAt, baselineGenerationId,
      materials, baseline, changedKinds: changedKinds(current, baseline),
    };
  });
}

/**
 * The completed turns before the input (user inputs without a completed answer are left out) and
 * the input text. Each assistant reply carries the material versions its generation used.
 */
export async function loadHistory(db: Db, conversationId: string, inputMessageId: string) {
  const { rows } = await db.query<{ id: string; role: "user" | "assistant"; parts: { type: string; text?: string }[]; generationId: string | null }>(`
    SELECT m.id, m.role, m.parts, m.generation_id AS "generationId"
    FROM public.messages m
    WHERE m.conversation_id = $1
      AND m.sequence_no <= (SELECT sequence_no FROM public.messages WHERE id = $2 AND conversation_id = $1)
      AND (m.id = $2 OR m.role = 'assistant' OR EXISTS (
        SELECT 1 FROM public.generation_runs g WHERE g.input_message_id = m.id AND g.status = 'completed'))
    ORDER BY m.sequence_no
  `, [conversationId, inputMessageId]);
  const generationIds = rows.flatMap((row) => row.generationId ?? []);
  const { rows: used } = await db.query<MaterialVersion & { generationId: string; kind: string }>(`
    SELECT gm.generation_id AS "generationId", s.kind, s.fingerprint, s.availability,
           s.reason_code AS "reasonCode", s.source_label AS "sourceLabel"
    FROM public.generation_materials gm
    JOIN public.material_snapshots s ON s.id = gm.snapshot_id AND s.conversation_id = gm.conversation_id AND s.kind = gm.kind
    WHERE gm.generation_id = ANY($1::uuid[])
  `, [generationIds]);

  const text = (parts: { type: string; text?: string }[]) => parts.flatMap((part) => part.type === "text" ? part.text ?? "" : []).join("");
  const input = rows.at(-1);
  if (input?.id !== inputMessageId) throw new Error("Generation input message not found");
  const history: HistoryEntry[] = rows.slice(0, -1).map((row) => {
    if (row.role === "user") return { role: "user", text: text(row.parts) };
    const materials: Record<string, MaterialVersion> = {};
    for (const { generationId, kind, ...version } of used) {
      if (generationId === row.generationId) materials[kind] = version;
    }
    return { role: "assistant", text: text(row.parts), materials };
  });
  return { history, input: text(input.parts) };
}

/**
 * Step 6: save the complete reply and mark the run completed together, which makes it the new
 * baseline. Returns null when the run is no longer streaming (a stale or repeated call).
 */
export function completeGeneration(pool: Pool, conversationId: string, generationId: string, text: string,
  modelMetadata: Record<string, unknown> | null = null): Promise<MessageView | null> {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT id FROM public.conversations WHERE id = $1 FOR UPDATE", [conversationId]);
    const { rows: [run] } = await client.query<{ status: string }>(`
      SELECT status FROM public.generation_runs WHERE id = $1 AND conversation_id = $2 FOR UPDATE
    `, [generationId, conversationId]);
    if (run?.status !== "streaming") return null;
    const sequenceNo = await allocateSequence(client, conversationId);
    const { rows: [message] } = await client.query<MessageView>(`
      INSERT INTO public.messages (conversation_id, generation_id, sequence_no, role, parts)
      VALUES ($1, $2, $3, 'assistant', $4) RETURNING ${MESSAGE_FIELDS}
    `, [conversationId, generationId, sequenceNo, JSON.stringify([{ type: "text", text }])]);
    await client.query(`
      UPDATE public.generation_runs SET status = 'completed', completed_at = statement_timestamp(), model_metadata = $2
      WHERE id = $1
    `, [generationId, modelMetadata]);
    return message;
  });
}

/** Marks a still-active run failed or interrupted. Returns false when it had already ended. */
export function endGeneration(pool: Pool, conversationId: string, generationId: string,
  status: "failed" | "interrupted", errorCode: string): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT id FROM public.conversations WHERE id = $1 FOR UPDATE", [conversationId]);
    const { rowCount } = await client.query(`
      UPDATE public.generation_runs SET status = $3, error_code = $4, completed_at = statement_timestamp()
      WHERE id = $1 AND conversation_id = $2 AND status IN ('preparing', 'streaming')
    `, [generationId, conversationId, status, errorCode]);
    return rowCount === 1;
  });
}
