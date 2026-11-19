import type { RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Database } from "../db/transaction.js";
import { isUuid } from "../lib/uuid.js";
import type { AuthenticatedSession, SessionReader, VerifiedAuthContext } from "../modules/auth/types.js";

export type OwnedResourceKind = "application" | "resume" | "workspace" | "conversation";

// Business error bodies (endpoints.json `Error`). The 401 text is the same wherever it is sent.
const UNAUTHORIZED = { status: 401, code: "UNAUTHORIZED", message: "A valid session is required." } as const;
const EMAIL_NOT_VERIFIED = { status: 403, code: "EMAIL_NOT_VERIFIED", message: "Verify your email before accessing this resource." } as const;
const NOT_FOUND = { status: 404, code: "NOT_FOUND", message: "Resource not found." } as const;

// These identifiers come from the reviewed business schema, never a request or
// model argument. The business handlers still validate the resource lifecycle.
const OWNERSHIP_QUERIES: Readonly<Record<OwnedResourceKind, string>> = Object.freeze({
  application: `SELECT a.id
    FROM public.applications AS a
    WHERE a.id = $1 AND a.user_id = $2
    LIMIT 1`,
  resume: `SELECT r.id
    FROM public.resumes AS r
    WHERE r.id = $1 AND r.user_id = $2 AND r.deleted_at IS NULL
    LIMIT 1`,
  workspace: `SELECT w.id
    FROM public.ai_workspaces AS w
    JOIN public.applications AS a ON a.id = w.application_id
    WHERE w.id = $1 AND a.user_id = $2
    LIMIT 1`,
  conversation: `SELECT c.id
    FROM public.conversations AS c
    JOIN public.ai_workspaces AS w ON w.id = c.workspace_id
    JOIN public.applications AS a ON a.id = w.application_id
    WHERE c.id = $1 AND a.user_id = $2
    LIMIT 1`,
});

function reject(res: Response, { status, code, message }: { status: number; code: string; message: string }): void {
  res.status(status).json({ error: { code, message } });
}

/** A Session the reader returned is usable only if it is complete, consistent and unexpired. */
function isLiveSession(data: AuthenticatedSession | null): data is AuthenticatedSession {
  if (!data || !data.user.id || !data.session.id || data.session.userId !== data.user.id) return false;
  const expiresAt = data.session.expiresAt;
  return expiresAt instanceof Date && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > Date.now();
}

function verifiedContext(res: Response): VerifiedAuthContext | undefined {
  const context = res.locals.auth;
  return context && context.emailVerified === true && context.userId && context.sessionId ? context : undefined;
}

/**
 * Requires a current Session and a verified mailbox, then sets `res.locals.auth`. `createApp`
 * runs it for all of `/api/v1`. Session-store failures go to the error handler (503/500):
 * an unreachable database is not proof that the caller is anonymous.
 */
export function requireVerifiedUser(reader: SessionReader): RequestHandler {
  return async (req, res, next) => {
    // Only this middleware may establish the trusted context for this request.
    delete res.locals.auth;
    try {
      const data = await reader.getSession(fromNodeHeaders(req.headers));
      if (!isLiveSession(data)) { reject(res, UNAUTHORIZED); return; }
      if (data.user.emailVerified !== true) { reject(res, EMAIL_NOT_VERIFIED); return; }
      res.locals.auth = { userId: data.user.id, sessionId: data.session.id, emailVerified: true };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * For routers mounted under /api/v1, where `createApp` has already run `requireVerifiedUser`:
 * confirms the trusted context without reading the Session again. Pass it as a router's
 * `authenticate` option. Anywhere else it answers 401.
 */
export const requireAuthContext: RequestHandler = (_req, res, next) => {
  if (!verifiedContext(res)) { reject(res, UNAUTHORIZED); return; }
  next();
};

/**
 * The trusted identity inside a business handler behind `requireVerifiedUser`. Throws (500) if
 * called anywhere else, because that is a wiring bug, not an anonymous request.
 */
export function getAuthContext(res: Response): VerifiedAuthContext {
  const context = verifiedContext(res);
  if (!context) throw new Error("getAuthContext called on a route without requireVerifiedUser");
  return context;
}

/**
 * Checks the resource against the server-established user identity. Missing,
 * malformed and other users' identities share the same not-found response.
 */
export function requireOwnedResource(
  database: Database,
  kind: OwnedResourceKind,
  paramName: string,
): RequestHandler {
  if (!Object.hasOwn(OWNERSHIP_QUERIES, kind)) {
    throw new Error("Unsupported owned resource kind");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(paramName)) {
    throw new Error("A valid resource route parameter name is required");
  }
  const query = OWNERSHIP_QUERIES[kind];

  return async (req, res, next) => {
    const context = verifiedContext(res);
    if (!context) { reject(res, UNAUTHORIZED); return; }

    const resourceId = req.params[paramName];
    if (!isUuid(resourceId)) { reject(res, NOT_FOUND); return; }

    try {
      const result = await database.query<{ id: string }>(query, [resourceId, context.userId]);
      if (!result.rows.length) { reject(res, NOT_FOUND); return; }
      next();
    } catch (error) {
      next(error);
    }
  };
}
