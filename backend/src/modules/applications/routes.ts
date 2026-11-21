import { Router, type ErrorRequestHandler } from "express";
import { getAuthContext } from "../../http/authorization.js";
import { isUuid } from "../../lib/uuid.js";
import { ApplicationError, notFound } from "./errors.js";
import type { ApplicationService } from "./service.js";
import { parseCreate, parseListQuery, parseReplace } from "./validation.js";

export interface ApplicationRouterOptions {
  service: ApplicationService;
}

/**
 * `/api/v1/applications` routes. Mount inside `createApp({ businessRouter })`, which has already
 * run the origin check and `requireVerifiedUser`; the user always comes from `getAuthContext(res)`,
 * never from the request. Another user's application and a malformed ID both answer 404.
 *
 *   GET    /                 list (q, status, sort) with per-status counts
 *   POST   /                 create → 201 + Location
 *   GET    /:applicationId   detail with interviews and status history
 *   PUT    /:applicationId   full replacement (optional rowVersion → 409 on conflict)
 *   DELETE /:applicationId   hard delete → 204; 409 while an AI generation is active
 */
export function createApplicationRouter({ service }: ApplicationRouterOptions): Router {
  const router = Router();

  const applicationId = (value: unknown): string => {
    if (!isUuid(value)) throw notFound();
    return value.toLowerCase();
  };

  router.get("/", async (req, res) => {
    const { userId } = getAuthContext(res);
    res.json(await service.list(userId, parseListQuery(req.query as Record<string, unknown>)));
  });

  router.post("/", async (req, res) => {
    const { userId } = getAuthContext(res);
    const created = await service.create(userId, parseCreate(req.body));
    res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
  });

  router.get("/:applicationId", async (req, res) => {
    const { userId } = getAuthContext(res);
    res.json(await service.get(userId, applicationId(req.params.applicationId)));
  });

  router.put("/:applicationId", async (req, res) => {
    const { userId } = getAuthContext(res);
    const id = applicationId(req.params.applicationId);
    const { input, rowVersion } = parseReplace(req.body);
    res.json(await service.replace(userId, id, input, rowVersion));
  });

  router.delete("/:applicationId", async (req, res) => {
    const { userId } = getAuthContext(res);
    await service.remove(userId, applicationId(req.params.applicationId));
    res.status(204).end();
  });

  // Expected rejections become the documented error body; anything else goes on to app.ts
  // (503 when PostgreSQL is unreachable, otherwise 500).
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (!(error instanceof ApplicationError) || res.headersSent) { next(error); return; }
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  };
  router.use(errors);
  return router;
}
