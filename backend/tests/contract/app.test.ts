import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../../src/app.js";
import type { Database } from "../../src/db/transaction.js";
import type { Authentication } from "../../src/modules/auth/auth.js";
import type { AuthenticatedSession } from "../../src/modules/auth/types.js";

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

function verifiedSession(): AuthenticatedSession {
  const now = new Date();
  const userId = "11111111-1111-4111-8111-111111111111";
  return {
    user: { id: userId, email: "a@example.test", emailVerified: true, name: "A", createdAt: now, updatedAt: now },
    session: { id: "22222222-2222-4222-8222-222222222222", userId, token: "t", expiresAt: new Date(now.getTime() + 60_000), createdAt: now, updatedAt: now },
  };
}

/** createApp with a stub Session reader; no database or Better Auth instance. */
async function serve(t: test.TestContext, getSession: () => Promise<AuthenticatedSession | null>, businessRouter = Router()) {
  const authentication = {
    getSession,
    handler: async () => new Response(null, { status: 404 }),
    drainEmailQueue: async () => {},
    close: async () => {},
  } satisfies Authentication;
  const app = createApp({ authentication, database: {} as Database, environment: { auth: config, trustProxyHops: 0 }, businessRouter });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function errorOf(response: Response) {
  return { status: response.status, ...(await response.json() as { error: { code: string; message: string } }).error };
}

test("an unreachable session store answers 503, not 401 or a leaked driver message", async (t) => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secret"), { code: "ECONNREFUSED" });
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  const base = await serve(t, async () => { throw refused; });
  const answer = await errorOf(await fetch(`${base}/api/v1/applications`, { headers: { origin: ORIGIN } }));
  assert.equal(answer.status, 503);
  assert.equal(answer.code, "SERVICE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(logged), /secret|10\.0\.0\.5/);
});

test("unexpected failures use the documented INTERNAL_ERROR body", async (t) => {
  t.mock.method(console, "error", () => {});
  const router = Router();
  router.get("/boom", () => { throw new Error("bug with private detail"); });
  const base = await serve(t, async () => verifiedSession(), router);
  const answer = await errorOf(await fetch(`${base}/api/v1/boom`, { headers: { origin: ORIGIN } }));
  assert.deepEqual(answer, { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." });
});

test("only body-parser errors become 400/413; other 4xx-looking errors stay internal", async (t) => {
  t.mock.method(console, "error", () => {});
  const router = Router();
  router.post("/status-error", () => { throw Object.assign(new Error("library error"), { status: 400 }); });
  const base = await serve(t, async () => verifiedSession(), router);
  const post = (path: string, body: string) => fetch(`${base}/api/v1${path}`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body,
  });
  assert.equal((await errorOf(await post("/anything", "{not json"))).code, "BAD_REQUEST");
  const large = await errorOf(await post("/anything", JSON.stringify({ text: "x".repeat(1_100_000) })));
  assert.deepEqual([large.status, large.code], [413, "PAYLOAD_TOO_LARGE"]);
  assert.equal((await errorOf(await post("/status-error", "{}"))).code, "INTERNAL_ERROR");
});

test("CORS lets the trusted frontend read Retry-After, Location and Content-Disposition", async (t) => {
  const base = await serve(t, async () => null);
  const response = await fetch(`${base}/api/v1/resumes`, { headers: { origin: ORIGIN } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("access-control-expose-headers"), "Retry-After,Location,Content-Disposition");
  const untrusted = await fetch(`${base}/api/v1/resumes`, { headers: { origin: "https://evil.example" } });
  assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
});
