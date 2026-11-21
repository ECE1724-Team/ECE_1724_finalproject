import { responseError } from "@/lib/response-error";
import type {
  AiApplicationList, AiApplicationStatus, AiConversation, AiConversationList, AiGeneration, AiMaterialSnapshot,
  AiMessageList, AiStreamEvent, AiWorkspace,
} from "@/types";

// AI Copilot API (endpoints.json tag "AI Copilot"; summary in backend/README.md#ai-copilot).
// Every request sends the session cookie.

async function request<T>(path: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { credentials: "include", ...init });
  if (!response.ok) throw await responseError(response, fallback);
  return await response.json() as T;
}

export function listAiApplications(query: { q?: string; status?: AiApplicationStatus }, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  return request<AiApplicationList>(`/ai/applications?${params}`, "Failed to load applications.", { signal });
}

/** Creates the application's workspace on first entry, then returns the same one. */
export function openWorkspace(applicationId: string) {
  return request<AiWorkspace>(`/applications/${encodeURIComponent(applicationId)}/ai-workspace`,
    "Failed to open the AI workspace.", { method: "PUT" });
}

export function getWorkspace(workspaceId: string, signal?: AbortSignal) {
  return request<AiWorkspace>(`/ai/workspaces/${encodeURIComponent(workspaceId)}`, "Failed to load the workspace.", { signal });
}

export function listConversations(workspaceId: string, signal?: AbortSignal) {
  return request<AiConversationList>(`/ai/workspaces/${encodeURIComponent(workspaceId)}/conversations`,
    "Failed to load conversations.", { signal });
}

export function createConversation(workspaceId: string) {
  return request<AiConversation>(`/ai/workspaces/${encodeURIComponent(workspaceId)}/conversations`,
    "Failed to create a conversation.", { method: "POST" });
}

export function getConversation(conversationId: string, signal?: AbortSignal) {
  return request<AiConversation>(`/ai/conversations/${encodeURIComponent(conversationId)}`,
    "Failed to load the conversation.", { signal });
}

export function listMessages(conversationId: string, signal?: AbortSignal) {
  return request<AiMessageList>(`/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
    "Failed to load messages.", { signal });
}

/** Reads an attempt's durable state, e.g. after the stream closed without a terminal event. */
export function getGeneration(conversationId: string, generationId: string, signal?: AbortSignal) {
  return request<AiGeneration>(
    `/ai/conversations/${encodeURIComponent(conversationId)}/generations/${encodeURIComponent(generationId)}`,
    "Failed to load the reply status.", { signal });
}

/** The material text an earlier answer was based on. */
export function getMaterialSnapshot(conversationId: string, snapshotId: string, signal?: AbortSignal) {
  return request<AiMaterialSnapshot>(
    `/ai/conversations/${encodeURIComponent(conversationId)}/material-snapshots/${encodeURIComponent(snapshotId)}`,
    "Failed to load the material.", { signal });
}

/**
 * Sends a message (or retries `retryGenerationId`) and calls `onEvent` for each SSE event until the
 * stream ends. Errors before the stream opens (400/404/409/503) reject with the server message.
 * The browser's EventSource only supports GET, so this reads the POST response body directly.
 */
export async function streamGeneration(
  _conversationId: string,
  _input: { content: string } | { retryGenerationId: string },
  _onEvent: (event: AiStreamEvent) => void,
  _signal?: AbortSignal,
): Promise<void> {
  // TODO(Phase 5): POST, then parse `event:`/`data:` frames from response.body.
  throw new Error("Not implemented yet.");
}
