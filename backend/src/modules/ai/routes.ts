import { Router, type ErrorRequestHandler, type Request, type Response } from "express";
import type { Pool } from "pg";
import { getAuthContext } from "../../http/authorization.js";
import type { ChatModel } from "../../integrations/llm/openai.js";
import { isUuid } from "../../lib/uuid.js";
import { createPostgresApplicationRepository } from "../applications/postgres-repository.js";
import type { ApplicationStatus } from "../applications/repository.js";
import { isDbUnavailable } from "../resumes/errors.js";
import {
  createConversation, getConversation, getSnapshot, listConversations, listMessages,
} from "./conversations/postgres-repository.js";
import { acceptInput, acceptRetry, listGenerations, type AcceptResult } from "./generations/postgres-repository.js";
import { runTurn, type StreamEvent } from "./generations/service.js";
import { ensureWorkspace, getWorkspace } from "./workspaces/postgres-repository.js";

// AI Copilot routes (endpoints.json tag "AI Copilot"). Mounted on createApp's business router, so
// every handler runs behind the Origin check and requireVerifiedUser. Missing, malformed and other
// users' IDs all answer 404.

export interface AiRouterOptions {
  pool: Pool;
  /** The reply model; without one, reads work and sends answer 503. */
  model?: ChatModel;
}

const STATUSES: readonly ApplicationStatus[] = ["saved", "applied", "oa", "interview", "offer", "rejected"];

export function createAiRouter({ pool, model }: AiRouterOptions): Router {
  const router = Router();
  const applications = createPostgresApplicationRepository();

  router.get("/ai/applications", async (req, res) => {
    const { q, status } = req.query;
    if ((q !== undefined && typeof q !== "string")
      || (status !== undefined && !STATUSES.includes(status as ApplicationStatus))) {
      return sendError(res, 400, "BAD_REQUEST", "q must be a single string and status one of the six application statuses.");
    }
    const rows = await applications.list(pool, userIdOf(res), { search: q, status: status as ApplicationStatus | undefined });
    res.json({ data: rows.map(({ id, companyName, positionTitle, status }) => ({ id, companyName, jobTitle: positionTitle, status })) });
  });

  router.put("/applications/:applicationId/ai-workspace", async (req, res) => {
    const id = idParam(req, "applicationId");
    const workspace = id && (await ensureWorkspace(pool, userIdOf(res), id));
    if (!workspace) return sendNotFound(res);
    res.json(workspace);
  });

  router.get("/ai/workspaces/:workspaceId", async (req, res) => {
    const id = idParam(req, "workspaceId");
    const workspace = id && (await getWorkspace(pool, userIdOf(res), id));
    if (!workspace) return sendNotFound(res);
    res.json(workspace);
  });

  router.get("/ai/workspaces/:workspaceId/conversations", async (req, res) => {
    const id = idParam(req, "workspaceId");
    const conversations = id && (await listConversations(pool, userIdOf(res), id));
    if (!conversations) return sendNotFound(res);
    res.json({ data: conversations });
  });

  router.post("/ai/workspaces/:workspaceId/conversations", async (req, res) => {
    const id = idParam(req, "workspaceId");
    const conversation = id && (await createConversation(pool, userIdOf(res), id));
    if (!conversation) return sendNotFound(res);
    res.status(201).location(`/api/v1/ai/conversations/${conversation.id}`).json(conversation);
  });

  router.get("/ai/conversations/:conversationId", async (req, res) => {
    const id = idParam(req, "conversationId");
    const conversation = id && (await getConversation(pool, userIdOf(res), id));
    if (!conversation) return sendNotFound(res);
    res.json(conversation);
  });

  router.get("/ai/conversations/:conversationId/messages", async (req, res) => {
    const id = idParam(req, "conversationId");
    const messages = id && (await listMessages(pool, userIdOf(res), id));
    if (!messages) return sendNotFound(res);
    res.json({ data: messages });
  });

  router.get("/ai/conversations/:conversationId/generations", async (req, res) => {
    const id = idParam(req, "conversationId");
    const generations = id && (await listGenerations(pool, userIdOf(res), id));
    if (!generations) return sendNotFound(res);
    res.json({ data: generations });
  });

  router.get("/ai/conversations/:conversationId/generations/:generationId", async (req, res) => {
    const conversationId = idParam(req, "conversationId");
    const generationId = idParam(req, "generationId");
    const [generation] = (conversationId && generationId
      && (await listGenerations(pool, userIdOf(res), conversationId, generationId))) || [];
    if (!generation) return sendNotFound(res);
    res.json(generation);
  });

  router.get("/ai/conversations/:conversationId/material-snapshots/:snapshotId", async (req, res) => {
    const conversationId = idParam(req, "conversationId");
    const snapshotId = idParam(req, "snapshotId");
    const snapshot = conversationId && snapshotId && (await getSnapshot(pool, userIdOf(res), conversationId, snapshotId));
    if (!snapshot) return sendNotFound(res);
    const { sourceLabel: _label, ...body } = snapshot; // not part of AiMaterialSnapshot
    res.json(body);
  });

  router.post("/ai/conversations/:conversationId/generations", async (req, res) => {
    const id = idParam(req, "conversationId");
    if (!id) return sendNotFound(res);
    const body: unknown = req.body;
    const content = (body as { content?: unknown } | undefined)?.content;
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1
      || typeof content !== "string" || !content.trim()) {
      return sendError(res, 400, "BAD_REQUEST", "Send a JSON body with a non-blank content string only.");
    }
    if (!model) return sendGenerationUnavailable(res);
    await streamTurn(res, id, await acceptInput(pool, userIdOf(res), id, content));
  });

  router.post("/ai/conversations/:conversationId/generations/:generationId/retry", async (req, res) => {
    const conversationId = idParam(req, "conversationId");
    const generationId = idParam(req, "generationId");
    if (!conversationId || !generationId) return sendNotFound(res);
    if (!model) return sendGenerationUnavailable(res);
    await streamTurn(res, conversationId, await acceptRetry(pool, userIdOf(res), conversationId, generationId));
  });

  /** JSON errors before the stream opens; SSE events after it (endpoints.json AiGenerationStream). */
  async function streamTurn(res: Response, conversationId: string, accepted: AcceptResult) {
    if (accepted.outcome !== "ACCEPTED") {
      if (accepted.outcome === "NOT_FOUND") return sendNotFound(res);
      return sendError(res, 409, accepted.outcome, accepted.outcome === "GENERATION_ACTIVE"
        ? "Another reply is in progress in this conversation."
        : "Only the latest message's failed or interrupted reply can be retried.");
    }
    // The client leaving aborts the model call; the run is then marked interrupted.
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableFinished) controller.abort(); });
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const emit = (event: StreamEvent) => {
      if (!res.destroyed && !res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const { generationId, inputMessage } = accepted;
    emit({ type: "generation.accepted", generationId, inputMessage });
    await runTurn({ pool, model: model!, userId: userIdOf(res), conversationId, generationId, signal: controller.signal, emit });
    res.end();
  }

  // Express 5 forwards async handler errors here. Anything that is not a database outage goes on
  // to createApp's handler (500).
  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent || !isDbUnavailable(error)) return next(error);
    console.error("AI request failed: database unavailable");
    sendError(res, 503, "AI_SERVICE_UNAVAILABLE", "The AI service is temporarily unavailable. Please try again.");
  };
  router.use(handleError);
  return router;
}

function userIdOf(res: Response): string {
  return getAuthContext(res).userId;
}

// A non-UUID ID cannot exist, and would make PostgreSQL throw a cast error.
function idParam(req: Request, name: string): string | null {
  const id = req.params[name];
  return isUuid(id) ? id : null;
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function sendGenerationUnavailable(res: Response): void {
  sendError(res, 503, "AI_SERVICE_UNAVAILABLE", "AI replies are not configured on this server.");
}

function sendNotFound(res: Response): void {
  sendError(res, 404, "NOT_FOUND", "Resource not found.");
}
