import type { Pool } from "pg";
import { buildPrompt, type PromptMessage } from "../context/prompt.js";
import { endGeneration, loadHistory, prepareMaterials, type PreparedTurn } from "./postgres-repository.js";

/**
 * Fixes the materials for an accepted attempt and assembles its model request. If preparation
 * fails, it is rolled back, the attempt is marked failed with MATERIAL_REFRESH_FAILED (the accepted
 * input stays for a retry) and the error is rethrown, so no model call happens. Returns null when
 * the attempt is no longer preparing.
 */
export async function prepareTurn(pool: Pool, userId: string, conversationId: string, generationId: string)
  : Promise<{ prepared: PreparedTurn; prompt: PromptMessage[] } | null> {
  let prepared: PreparedTurn | null;
  try {
    prepared = await prepareMaterials(pool, userId, conversationId, generationId);
  } catch (error) {
    try {
      await endGeneration(pool, conversationId, generationId, "failed", "MATERIAL_REFRESH_FAILED");
    } catch {
      // Storage is unavailable: startup recovery marks the run interrupted after a restart.
      console.error("Could not record a material preparation failure");
    }
    throw error;
  }
  if (!prepared) return null;
  const { history, input } = await loadHistory(pool, conversationId, prepared.inputMessageId);
  return { prepared, prompt: buildPrompt({ materials: prepared.materials, baseline: prepared.baseline, history, input }) };
}
