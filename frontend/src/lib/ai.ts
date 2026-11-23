import { responseError } from "@/lib/response-error";
import type {
  AiApplicationList, AiApplicationStatus, AiConversation, AiConversationList, AiGenerationList, AiMaterialSnapshot,
  AiMessage, AiMessageList, AiStreamEvent, AiWorkspace,
} from "@/types";

// AI Copilot API (endpoints.json tag "AI Copilot"; summary in backend/README.md#ai-copilot).
// Every request sends the session cookie.

async function request<T>(path: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { credentials: "include", ...init });
  if (!response.ok) throw await responseError(response, fallback);
  return await response.json() as T;
}

const conversationPath = (conversationId: string) => `/ai/conversations/${encodeURIComponent(conversationId)}`;

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

export function renameConversation(conversationId: string, title: string) {
  return request<AiConversation>(conversationPath(conversationId), "Failed to rename the conversation.", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function getConversation(conversationId: string, signal?: AbortSignal) {
  return request<AiConversation>(conversationPath(conversationId), "Failed to load the conversation.", { signal });
}

export function listMessages(conversationId: string, signal?: AbortSignal) {
  return request<AiMessageList>(`${conversationPath(conversationId)}/messages`, "Failed to load messages.", { signal });
}

/**
 * Every attempt, newest first: which materials each reply used, and whether the latest message
 * failed, was interrupted or is still being answered (e.g. after the stream closed early).
 */
export function listGenerations(conversationId: string, signal?: AbortSignal) {
  return request<AiGenerationList>(`${conversationPath(conversationId)}/generations`,
    "Failed to load the reply status.", { signal });
}

/** The material text an earlier answer was based on. */
export function getMaterialSnapshot(conversationId: string, snapshotId: string, signal?: AbortSignal) {
  return request<AiMaterialSnapshot>(
    `${conversationPath(conversationId)}/material-snapshots/${encodeURIComponent(snapshotId)}`,
    "Failed to load the material.", { signal });
}

/**
 * Sends a message (or retries `retryGenerationId`) and calls `onEvent` for each SSE event until the
 * stream ends. Errors before the stream opens (400/404/409/503) reject with the server message.
 * The stream may end without a terminal event (network loss, abort): callers then reread the
 * conversation instead of assuming the reply was saved. EventSource only supports GET, so this
 * reads the POST response body directly.
 */
export async function streamGeneration(
  conversationId: string,
  input: { content: string } | { retryGenerationId: string },
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const path = "content" in input
    ? `${conversationPath(conversationId)}/generations`
    : `${conversationPath(conversationId)}/generations/${encodeURIComponent(input.retryGenerationId)}/retry`;
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "include",
    signal,
    ...("content" in input && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input.content }),
    }),
  });
  if (!response.ok) throw await responseError(response, "Failed to send the message.");

  // Frames are `event: <type>\ndata: <json>\n\n`; the JSON's own `type` names the event.
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const data = buffer.slice(0, end).split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      buffer = buffer.slice(end + 2);
      if (data) onEvent(JSON.parse(data) as AiStreamEvent);
    }
  }
}

export function messageText(message: AiMessage): string {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
}

// Material kinds come from the backend registry; unknown kinds are shown by their identifier.
const MATERIAL_LABELS: Record<string, string> = {
  resume: "Resume",
  jd: "Job description",
  company: "Company",
  position: "Position",
  company_website_url: "Company website",
  company_notes: "Company notes",
};
const MATERIAL_ORDER = Object.keys(MATERIAL_LABELS);

export function materialLabel(kind: string): string {
  return MATERIAL_LABELS[kind] ?? kind;
}

/** Registry order first, unknown kinds after. */
export function sortByKind<T extends { kind: string }>(materials: T[]): T[] {
  const rank = (kind: string) => {
    const index = MATERIAL_ORDER.indexOf(kind);
    return index === -1 ? MATERIAL_ORDER.length : index;
  };
  return [...materials].sort((a, b) => rank(a.kind) - rank(b.kind));
}

export function unavailableReason(reasonCode: string | null): string {
  switch (reasonCode) {
    case "RESUME_NOT_LINKED": return "Not linked";
    case "RESUME_TEXT_UNAVAILABLE": return "Text could not be read";
    case "FIELD_MISSING": return "Not provided";
    default: return "Unavailable";
  }
}
