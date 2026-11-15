import type { RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Database } from "../db/transaction.js";
import type { SessionReader, VerifiedAuthContext } from "../modules/auth/types.js";

export type OwnedResourceKind = "application" | "resume" | "workspace" | "conversation";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reject(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Requires a current Session and verified mailbox before protected access. */
export function requireVerifiedUser(reader: SessionReader): RequestHandler {
  return async (req, res, next) => {
    // Only this middleware may establish the trusted context for this request.
    delete res.locals.auth;
    try {
      const data = await reader.getSession(fromNodeHeaders(req.headers));
      if (!data || !data.user.id || !data.session.id
        || data.session.userId !== data.user.id
        || !(data.session.expiresAt instanceof Date)
        || data.session.expiresAt.getTime() <= Date.now()
        || !Number.isFinite(data.session.expiresAt.getTime())) {
        reject(res, 401, "UNAUTHORIZED", "A valid session is required.");
        return;
      }
      if (data.user.emailVerified !== true) {
        reject(res, 403, "EMAIL_NOT_VERIFIED", "Email verification is required.");
        return;
      }

      const context: VerifiedAuthContext = {
        userId: data.user.id,
        sessionId: data.session.id,
        emailVerified: true,
      };
      res.locals.auth = context;
      next();
    } catch (error) {
      // Database/service failures are not proof that a user is unauthenticated.
      next(error);
    }
  };
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
    const context = res.locals.auth as VerifiedAuthContext | undefined;
    if (!context || context.emailVerified !== true || !context.userId || !context.sessionId) {
      reject(res, 401, "UNAUTHORIZED", "A verified session is required.");
      return;
    }

    const resourceId = req.params[paramName];
    if (typeof resourceId !== "string" || !UUID.test(resourceId)) {
      reject(res, 404, "NOT_FOUND", "Resource not found.");
      return;
    }

    try {
      const result = await database.query<{ id: string }>(query, [resourceId, context.userId]);
      if (!result.rows.length) {
        reject(res, 404, "NOT_FOUND", "Resource not found.");
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
