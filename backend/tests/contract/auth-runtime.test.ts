import assert from "node:assert/strict";
import test from "node:test";
import type { Response as ExpressResponse } from "express";
import type { Pool, PoolClient } from "pg";
import { ConfigurationError } from "../../src/config/errors.js";
import { loadEnvironment } from "../../src/config/env.js";
import { Database } from "../../src/db/transaction.js";
import { getAuthContext } from "../../src/http/authorization.js";
import { SMTP_TIMEOUTS, smtpTransportOptions } from "../../src/integrations/email/smtp.js";
import { createAuthentication } from "../../src/modules/auth/auth.js";
import type { AuthReportCode } from "../../src/modules/auth/errors.js";
import { resolveAuthRoute } from "../../src/modules/auth/routes.js";
import { assertAuthSchema } from "../../src/modules/auth/schema.js";

const ORIGIN = "http://localhost:5173";
const config = {
  baseUrl: "http://localhost:3000",
  secret: "x".repeat(48),
  trustedOrigins: ["http://localhost:3000", ORIGIN],
  sessionLifetimeSeconds: 604800,
  emailCooldownSeconds: 60,
  emailWindowSeconds: 900,
  emailMaxPerWindow: 5,
  secureCookies: false,
  cookieSameSite: "lax" as const,
};

const refused = () => Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" });

/** Authentication over a fake pool; `query` decides how each statement after BEGIN behaves. */
function authenticationWith(pool: Partial<Pool>) {
  const reports: AuthReportCode[] = [];
  const authentication = createAuthentication({
    database: new Database(pool as Pool),
    rateLimitPool: {} as Pool,
    config,
    emailSender: { sendAuthEmail: async () => {} },
    nativeRateLimitEnabled: false,
    reportError: (code) => { reports.push(code); },
  });
  return { authentication, reports };
}

function clientFailingWith(error: Error): Partial<Pool> {
  const client = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { command: sql, rows: [] };
      throw error;
    },
    release() {},
  } as unknown as PoolClient;
  return { connect: async () => client } as Partial<Pool>;
}

const signIn = (authentication: ReturnType<typeof authenticationWith>["authentication"]) =>
  authentication.handler(new Request(`${config.baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email: "someone@example.test", password: "a-strong-password-123" }),
  }));

test("auth endpoints answer 503 SERVICE_UNAVAILABLE when PostgreSQL refuses connections", async () => {
  const { authentication, reports } = authenticationWith({ connect: async () => { throw refused(); } } as Partial<Pool>);
  const response = await signIn(authentication);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "SERVICE_UNAVAILABLE", message: "Authentication is temporarily unavailable. Please try again." });
  assert.deepEqual(reports, ["AUTH_DATABASE_UNAVAILABLE"]);
});

test("a connection lost in the middle of a request is also 503, and nothing leaks", async () => {
  const lost = Object.assign(new Error("read ECONNRESET password=secret"), { code: "ECONNRESET" });
  const { authentication } = authenticationWith(clientFailingWith(lost));
  const response = await signIn(authentication);
  const text = await response.text();
  assert.equal(response.status, 503);
  assert.doesNotMatch(text, /secret|ECONNRESET/);
});

test("other unexpected failures stay 500 INTERNAL_SERVER_ERROR", async () => {
  const { authentication } = authenticationWith(clientFailingWith(new Error("bug in a query")));
  const response = await signIn(authentication);
  assert.equal(response.status, 500);
  assert.equal((await response.json() as { code: string }).code, "INTERNAL_SERVER_ERROR");
});

test("only the documented auth endpoints are exposed, each with one method", () => {
  assert.deepEqual(resolveAuthRoute("/api/auth/sign-in/email"), { path: "/sign-in/email", method: "POST" });
  assert.deepEqual(resolveAuthRoute("/api/auth/reset-password/abc"), { path: "/reset-password/abc", method: "GET" });
  assert.equal(resolveAuthRoute("/api/auth/reset-password/a/b"), null);
  assert.equal(resolveAuthRoute("/api/auth/delete-user"), null);
  assert.equal(resolveAuthRoute("/api/authx/sign-in/email"), null);
});

test("startup configuration problems are ConfigurationErrors that never echo the value", () => {
  const env = {
    BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "y".repeat(40), AUTH_TRUSTED_ORIGINS: ORIGIN,
    SMTP_HOST: "localhost", SMTP_FROM: "no-reply@example.test",
    DATABASE_URL: "postgresql://user:private-password@localhost",
  };
  assert.throws(() => loadEnvironment(env), (error: unknown) =>
    error instanceof ConfigurationError && /must name the PostgreSQL database/.test(error.message) && !error.message.includes("private-password"));
});

test("a missing auth table fails startup with the table names", async () => {
  const missing = { query: async () => ({ rows: [{ missing: ["auth_credential_state"] }] }) } as unknown as Pool;
  await assert.rejects(assertAuthSchema(missing), (error: unknown) =>
    error instanceof ConfigurationError && error.message.includes("auth_credential_state") && error.message.includes("npm run migrate"));
  const ready = { query: async () => ({ rows: [{ missing: [] }] }) } as unknown as Pool;
  await assertAuthSchema(ready);
});

test("SMTP sends are bounded by explicit timeouts", () => {
  const options = smtpTransportOptions({ host: "smtp.example.test", port: 587, secure: false, from: "a@example.test" });
  assert.equal(options.connectionTimeout, SMTP_TIMEOUTS.connectionTimeout);
  assert.equal(options.greetingTimeout, SMTP_TIMEOUTS.greetingTimeout);
  assert.equal(options.socketTimeout, SMTP_TIMEOUTS.socketTimeout);
  assert.ok(SMTP_TIMEOUTS.socketTimeout <= 30_000);
});

test("getAuthContext returns the verified identity and refuses to run without one", () => {
  const context = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "s", emailVerified: true as const };
  assert.deepEqual(getAuthContext({ locals: { auth: context } } as unknown as ExpressResponse), context);
  assert.throws(() => getAuthContext({ locals: {} } as unknown as ExpressResponse), /without requireVerifiedUser/);
});
