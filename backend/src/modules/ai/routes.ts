import { Router, type ErrorRequestHandler, type Request, type Response } from "express";
import type { Pool } from "pg";
import { getAuthContext } from "../../http/authorization.js";
import { isUuid } from "../../lib/uuid.js";
import { createPostgresApplicationRepository } from "../applications/postgres-repository.js";
import type { ApplicationStatus } from "../applications/repository.js";
import { isDbUnavailable } from "../resumes/errors.js";
import {
  createConversation, getConversation, listConversations, listMessages,
} from "./conversations/postgres-repository.js";
import { ensureWorkspace, getWorkspace } from "./workspaces/postgres-repository.js";

// AI Copilot routes (endpoints.json tag "AI Copilot"). Mounted on createApp's business router, so
// every handler runs behind the Origin check and requireVerifiedUser. Missing, malformed and other
// users' IDs all answer 404.

export interface AiRouterOptions {
  pool: Pool;
}

const STATUSES: readonly ApplicationStatus[] = ["saved", "applied", "oa", "interview", "offer", "rejected"];

export function createAiRouter({ pool }: AiRouterOptions): Router {
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

function sendNotFound(res: Response): void {
  sendError(res, 404, "NOT_FOUND", "Resource not found.");
}
