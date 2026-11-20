import type { Pool } from "pg";
import type { ChatModel } from "../../../integrations/llm/openai.js";
import { buildPrompt, type PromptMessage } from "../context/prompt.js";
import { listMessages, type MaterialReference, type MessageView } from "../conversations/postgres-repository.js";
import {
  ERROR_MESSAGES, completeGeneration, endGeneration, listGenerations, loadHistory, prepareMaterials,
  type GenerationView, type PreparedTurn,
} from "./postgres-repository.js";

// Coordinates one accepted attempt (Database Design §7.4 steps 2–6): fix the materials, assemble the
// request, stream the reply outside any transaction, then save it and complete the run together.

type Stage = "preparation" | "context" | "generation" | "persistence";

export type StreamEvent =
  | { type: "generation.accepted"; generationId: string; inputMessage: MessageView }
  | { type: "materials.synced"; generationId: string; snapshotAt: Date; baselineGenerationId: string | null;
      materials: Record<string, MaterialReference>; changedKinds: string[] }
  | { type: "text.delta"; generationId: string; delta: string }
  | { type: "generation.completed"; generation: GenerationView; message: MessageView }
  | { type: "generation.error"; generationId: string; stage: Stage; error: { code: string; message: string }; statePersisted: boolean };

/** A turn that ended without a reply; `statePersisted` says whether its terminal state was saved. */
export class TurnError extends Error {
  constructor(readonly stage: Stage, readonly code: string, readonly statePersisted: boolean) {
    super(code);
    this.name = "TurnError";
  }
}

async function recordEnd(pool: Pool, conversationId: string, generationId: string,
  status: "failed" | "interrupted", code: string): Promise<boolean> {
  try {
    await endGeneration(pool, conversationId, generationId, status, code);
    return true;
  } catch {
    // Storage is unavailable: startup recovery marks the run interrupted after a restart.
    console.error("Could not record a generation failure");
    return false;
  }
}

/**
 * Fixes the materials for an accepted attempt and assembles its model request. A preparation
 * failure is rolled back and recorded as MATERIAL_REFRESH_FAILED (the input stays for a retry), so no
 * model call happens. Returns null when the attempt is no longer preparing.
 */
export async function prepareTurn(pool: Pool, userId: string, conversationId: string, generationId: string)
  : Promise<{ prepared: PreparedTurn; prompt: PromptMessage[] } | null> {
  let prepared: PreparedTurn | null;
  try {
    prepared = await prepareMaterials(pool, userId, conversationId, generationId);
  } catch {
    const code = "MATERIAL_REFRESH_FAILED";
    throw new TurnError("preparation", code, await recordEnd(pool, conversationId, generationId, "failed", code));
  }
  if (!prepared) return null;
  try {
    const { history, input } = await loadHistory(pool, conversationId, prepared.inputMessageId);
    return { prepared, prompt: buildPrompt({ materials: prepared.materials, baseline: prepared.baseline, history, input }) };
  } catch {
    const code = "GENERATION_FAILED";
    throw new TurnError("context", code, await recordEnd(pool, conversationId, generationId, "failed", code));
  }
}

export interface RunTurnOptions {
  pool: Pool;
  model: ChatModel;
  userId: string;
  conversationId: string;
  generationId: string;
  /** Aborted when the client disconnects. */
  signal: AbortSignal;
  emit: (event: StreamEvent) => void;
}

/** Runs an accepted attempt to a terminal state and reports it through `emit`. Never throws. */
export async function runTurn(options: RunTurnOptions): Promise<void> {
  const { generationId, emit } = options;
  try {
    emit(await generate(options));
  } catch (error) {
    const failure = error instanceof TurnError ? error
      : new TurnError("generation", "GENERATION_FAILED",
        await recordEnd(options.pool, options.conversationId, generationId, "failed", "GENERATION_FAILED"));
    if (!(error instanceof TurnError)) console.error("AI turn failed:", describe(error));
    emit({
      type: "generation.error", generationId, stage: failure.stage, statePersisted: failure.statePersisted,
      error: { code: failure.code, message: ERROR_MESSAGES[failure.code] },
    });
  }
}

async function generate({ pool, model, userId, conversationId, generationId, signal, emit }: RunTurnOptions): Promise<StreamEvent> {
  const ready = await prepareTurn(pool, userId, conversationId, generationId);
  if (!ready) throw new TurnError("preparation", "GENERATION_INTERRUPTED", true);
  const { prepared, prompt } = ready;
  const materials: Record<string, MaterialReference> = {};
  for (const { kind, fingerprint, availability, sourceResumeId, reasonCode, snapshotId } of prepared.materials) {
    materials[kind] = { kind, fingerprint, availability, sourceResumeId, reasonCode, snapshotId };
  }
  emit({ type: "materials.synced", generationId, snapshotAt: prepared.snapshotAt,
    baselineGenerationId: prepared.baselineGenerationId, materials, changedKinds: prepared.changedKinds });

  let reply;
  try {
    reply = await model.streamReply({ messages: prompt, signal, onDelta: (delta) => emit({ type: "text.delta", generationId, delta }) });
  } catch (error) {
    // Partial output is discarded either way; only the run's terminal state is saved.
    const interrupted = signal.aborted;
    if (!interrupted) console.error("AI reply failed:", describe(error));
    const code = interrupted ? "GENERATION_INTERRUPTED" : "GENERATION_FAILED";
    throw new TurnError("generation", code, await recordEnd(pool, conversationId, generationId, interrupted ? "interrupted" : "failed", code));
  }

  const metadata = { provider: model.provider, model: model.modelId, inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens, finishReason: reply.finishReason };
  let message: MessageView | null | undefined;
  try {
    message = await completeGeneration(pool, conversationId, generationId, reply.text, metadata);
  } catch {
    message = undefined; // the commit outcome is unknown: check the run by its ID below
  }
  let generation: GenerationView | undefined;
  try {
    [generation] = (await listGenerations(pool, userId, conversationId, generationId)) ?? [];
    if (generation?.status === "completed" && !message) {
      message = (await listMessages(pool, userId, conversationId))?.find((m) => m.id === generation!.assistantMessageId);
    }
  } catch {
    throw new TurnError("persistence", "MESSAGE_PERSISTENCE_FAILED", false);
  }
  if (generation?.status !== "completed" || !message) {
    const code = "MESSAGE_PERSISTENCE_FAILED";
    throw new TurnError("persistence", code, await recordEnd(pool, conversationId, generationId, "failed", code));
  }
  return { type: "generation.completed", generation, message };
}

// Error messages and request details from the provider can quote the prompt; log the type only.
function describe(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? `${error.name} (HTTP ${status})` : error.name;
}
