import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "pg";
import { Database } from "../../src/db/transaction.js";
import { requireAuthContext, requireOwnedResource, requireVerifiedUser, type OwnedResourceKind } from "../../src/http/authorization.js";
import type { AuthenticatedSession, SessionReader, VerifiedAuthContext } from "../../src/modules/auth/types.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RESOURCE = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

function session(overrides: { verified?: boolean; owner?: string; sessionOwner?: string; expiry?: Date } = {}): AuthenticatedSession {
  const now = new Date();
  return {
    user: {
      id: overrides.owner ?? OWNER,
      email: "owner@example.test",
      emailVerified: overrides.verified ?? true,
      name: "Owner",
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: SESSION,
      userId: overrides.sessionOwner ?? overrides.owner ?? OWNER,
      token: "private-session-token",
      expiresAt: overrides.expiry ?? new Date(Date.now() + 60_000),
      createdAt: now,
      updatedAt: now,
    },
  };
}

function reader(data: AuthenticatedSession | null): SessionReader {
  return { async getSession() { return data; } };
}

async function invoke(
  handler: RequestHandler,
  request: Partial<Request> = {},
  locals: Record<string, unknown> = {},
) {
  let status = 200;
  let body: unknown;
  let nextCalled = false;
  let nextError: unknown;
  const response = {
    locals,
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  const next: NextFunction = (error?: unknown) => { nextCalled = true; nextError = error; };
  await handler({ headers: {}, params: {}, ...request } as Request, response, next);
  return { status, body, nextCalled, nextError, locals };
}

function dbWithQuery(run: (sql: string, values: unknown[]) => { id: string }[] | Promise<{ id: string }[]>) {
  return new Database({
    async query(sql: string, values: unknown[] = []) {
      const rows = await run(sql, values);
      return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
    },
  } as unknown as Pool);
}

function identity(userId = OWNER): VerifiedAuthContext {
  return { userId, sessionId: SESSION, emailVerified: true };
}

test("anonymous requests cannot establish identity with body/query flags or stale locals", async () => {
  const result = await invoke(requireVerifiedUser(reader(null)), {
    body: { userId: OWNER, emailVerified: true },
    query: { userId: OWNER, emailVerified: "true" },
  }, { auth: identity() });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: { code: "UNAUTHORIZED", message: "A valid session is required." } });
  assert.equal(result.locals.auth, undefined);
  assert.equal(result.nextCalled, false);
});

test("an unverified Session cannot use a client-supplied verification flag", async () => {
  const result = await invoke(requireVerifiedUser(reader(session({ verified: false }))), {
    body: { emailVerified: true },
  });
  assert.equal(result.status, 403);
  assert.equal((result.body as { error: { code: string } }).error.code, "EMAIL_NOT_VERIFIED");
  assert.equal(result.nextCalled, false);
  assert.equal(result.locals.auth, undefined);
});

test("expired, invalid-date, and mismatched Sessions fail closed", async () => {
  for (const data of [session({ expiry: new Date(0) }), session({ expiry: new Date(NaN) }), session({ sessionOwner: OTHER })]) {
    const result = await invoke(requireVerifiedUser(reader(data)));
    assert.equal(result.status, 401);
    assert.equal(result.nextCalled, false);
  }
});

test("verified identity comes only from the authoritative reader and excludes credentials", async () => {
  let seenHeaders: Headers | undefined;
  const result = await invoke(requireVerifiedUser({
    async getSession(headers) { seenHeaders = headers; return session(); },
  }), { headers: { cookie: "session=opaque", authorization: "Bearer ignored-by-test" }, body: { userId: OTHER } });
  assert.equal(seenHeaders?.get("cookie"), "session=opaque");
  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, undefined);
  assert.deepEqual(result.locals.auth, identity());
  assert.equal(JSON.stringify(result.locals.auth).includes("private-session-token"), false);
});

test("Session read failures reach the server error handler without leaking details", async () => {
  const error = new Error("database connection failed");
  const result = await invoke(requireVerifiedUser({ async getSession() { throw error; } }));
  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, error);
  assert.equal(result.body, undefined);
  assert.equal(result.locals.auth, undefined);
});

test("ownership checks require a trusted verified context before querying", async () => {
  let queries = 0;
  const db = dbWithQuery(() => { queries += 1; return []; });
  const result = await invoke(requireOwnedResource(db, "application", "applicationId"), {
    params: { applicationId: RESOURCE }, body: { userId: OWNER, emailVerified: true },
  });
  assert.equal(result.status, 401);
  assert.equal(queries, 0);
});

test("missing and malformed resource IDs produce the same 404 without SQL", async () => {
  let queries = 0;
  const db = dbWithQuery(() => { queries += 1; return []; });
  for (const id of [undefined, "not-a-uuid", "' OR true --", "33333333-3333-4333-8333-33333333333z"]) {
    const result = await invoke(requireOwnedResource(db, "application", "applicationId"), {
      params: id === undefined ? {} : { applicationId: id },
    }, { auth: identity() });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: { code: "NOT_FOUND", message: "Resource not found." } });
    assert.equal(result.nextCalled, false);
  }
  assert.equal(queries, 0);
});

test("application access binds the server's owner rather than request owner IDs", async () => {
  const db = dbWithQuery((sql, values) => {
    assert.match(sql, /a\.user_id = \$2/);
    assert.deepEqual(values, [RESOURCE, OWNER]);
    return [{ id: RESOURCE }];
  });
  const result = await invoke(requireOwnedResource(db, "application", "applicationId"), {
    params: { applicationId: RESOURCE }, body: { userId: OTHER }, query: { userId: OTHER },
  }, { auth: identity() });
  assert.equal(result.nextCalled, true);
  assert.equal(result.body, undefined);
});

test("a resource owned by another user has the same response as a missing resource", async () => {
  const db = dbWithQuery((_sql, values) => values[1] === OWNER ? [{ id: RESOURCE }] : []);
  const result = await invoke(requireOwnedResource(db, "application", "applicationId"), {
    params: { applicationId: RESOURCE }, body: { userId: OWNER },
  }, { auth: identity(OTHER) });
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { error: { code: "NOT_FOUND", message: "Resource not found." } });
  assert.equal(result.nextCalled, false);
});

test("workspace and conversation access follow the application ownership chain", async () => {
  for (const kind of ["workspace", "conversation"] as const) {
    const db = dbWithQuery((sql, values) => {
      assert.match(sql, /JOIN public\.applications AS a ON a\.id = w\.application_id/);
      if (kind === "conversation") assert.match(sql, /JOIN public\.ai_workspaces AS w ON w\.id = c\.workspace_id/);
      assert.match(sql, /a\.user_id = \$2/);
      assert.deepEqual(values, [RESOURCE, OWNER]);
      return [];
    });
    const result = await invoke(requireOwnedResource(db, kind, "id"), { params: { id: RESOURCE } }, { auth: identity() });
    assert.equal(result.status, 404);
    assert.equal(result.nextCalled, false);
  }
});

test("resume ownership requires a non-deleted library item", async () => {
  const db = dbWithQuery((sql, values) => {
    assert.match(sql, /r\.deleted_at IS NULL/);
    assert.deepEqual(values, [RESOURCE, OWNER]);
    return [];
  });
  const result = await invoke(requireOwnedResource(db, "resume", "id"), { params: { id: RESOURCE } }, { auth: identity() });
  assert.equal(result.status, 404);
  assert.equal(result.nextCalled, false);
});

test("ownership database failures are forwarded rather than exposing SQL or treating them as missing", async () => {
  const error = new Error("database temporarily unavailable");
  const db = dbWithQuery(() => { throw error; });
  const result = await invoke(requireOwnedResource(db, "application", "id"), { params: { id: RESOURCE } }, { auth: identity() });
  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, error);
  assert.equal(result.body, undefined);
});

test("resource kinds and route parameter names are server configuration", () => {
  const db = dbWithQuery(() => []);
  assert.throws(() => requireOwnedResource(db, "applications; DROP TABLE auth_user" as OwnedResourceKind, "id"));
  assert.throws(() => requireOwnedResource(db, "application", "id; DROP TABLE auth_user"));
});

test("requireAuthContext accepts only a complete verified context and never reads a Session", async () => {
  const accepted = await invoke(requireAuthContext, {}, { auth: identity() });
  assert.equal(accepted.nextCalled, true);
  for (const auth of [undefined, { userId: OWNER, sessionId: SESSION, emailVerified: false }, { userId: "", sessionId: SESSION, emailVerified: true }]) {
    const result = await invoke(requireAuthContext, {}, auth === undefined ? {} : { auth });
    assert.equal(result.nextCalled, false);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: { code: "UNAUTHORIZED", message: "A verified session is required." } });
  }
});
