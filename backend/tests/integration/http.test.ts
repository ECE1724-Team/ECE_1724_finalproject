import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Router } from "express";
import test from "node:test";
import type { Pool } from "pg";
import { createApp } from "../../src/app.js";
import { requireAuthContext, requireOwnedResource } from "../../src/http/authorization.js";
import { createResumeRouter } from "../../src/modules/resumes/routes.js";
import { createResumeService } from "../../src/modules/resumes/service.js";
import { FakeCleanupRepository, FakeResumeRepository, FakeStorage, extraction, fakeExtractor, pdfBytes } from "../fakes/resumes.js";
import { createAuthFixture, sessionCookie, uniqueEmail, verificationUrl, type AuthFixture } from "../helpers/auth-fixture.js";

/** Registers and verifies a user through the real auth flow; returns the user ID and Session cookie. */
async function verifiedUser(fixture: AuthFixture): Promise<{ id: string; cookie: string }> {
  const registered = await fixture.request("/api/auth/sign-up/email", { body: { name: "Resume owner", email: uniqueEmail(), password: "a-strong-password-123" } });
  const { user } = await registered.json() as { user: { id: string } };
  const verified = await fixture.request(verificationUrl(fixture.emails.at(-1)!, { callbackURL: null }));
  const cookie = sessionCookie(verified);
  assert.ok(cookie);
  return { id: user.id, cookie };
}

test("Express preserves auth bodies/cookies/CORS and enforces real SQL ownership", { timeout: 30000 }, async t => {
  const fixture = await createAuthFixture();
  const router = Router();
  for (const [path, kind, param] of [
    ["/applications/:applicationId", "application", "applicationId"],
    ["/resumes/:resumeId", "resume", "resumeId"],
    ["/workspaces/:workspaceId", "workspace", "workspaceId"],
    ["/conversations/:conversationId", "conversation", "conversationId"],
  ] as const) {
    router.get(path, requireOwnedResource(fixture.database, kind, param), (_req, res) => { res.json({ owner: res.locals.auth.userId }); });
  }
  const app = createApp({ authentication: fixture.authentication, database: fixture.database,
    environment: { auth: fixture.config, trustProxyHops: 0 }, businessRouter: router });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fixture.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const origin = "http://localhost:5173";
  const post = (path: string, body: unknown, cookie?: string) => fetch(base + path, {
    method: "POST", redirect: "manual",
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  const registered = await post("/api/auth/sign-up/email", { name: "HTTP Owner", email: uniqueEmail(), password: "a-strong-password-123" });
  assert.equal(registered.status, 200);
  assert.equal(registered.headers.get("access-control-allow-origin"), origin);
  assert.equal(registered.headers.get("access-control-allow-credentials"), "true");
  assert.equal(sessionCookie(registered), null);
  const registeredBody = await registered.json() as { token: null; user: { id: string } };
  assert.equal(registeredBody.token, null);
  await fixture.authentication.drainEmailQueue();
  const link = new URL(verificationUrl(fixture.emails[0]!, { callbackURL: null }));
  const verified = await fetch(base + link.pathname + link.search, { headers: { origin }, redirect: "manual" });
  assert.equal(verified.status, 200);
  const cookie = sessionCookie(verified);
  assert.ok(cookie);
  assert.ok(verified.headers.getSetCookie().some(value => /HttpOnly/i.test(value)));
  const loaded = await fetch(base + "/api/auth/get-session", { headers: { cookie, origin } });
  const loadedBody = await loaded.json() as { user: { id: string; emailVerified: boolean } };
  assert.equal(loadedBody.user.id, registeredBody.user.id);
  assert.equal(loadedBody.user.emailVerified, true);

  // Rows in the real business tables created by the merged migrations, so the
  // ownership queries are checked against the actual schema.
  const second = await fixture.request("/api/auth/sign-up/email", { body: { name: "Other", email: uniqueEmail(), password: "another-password-123" } });
  const other = (await second.json() as { user: { id: string } }).user.id;
  const own = registeredBody.user.id;
  const ownApp = randomUUID(), otherApp = randomUUID(), ownResume = randomUUID();
  const ownWorkspace = randomUUID(), otherWorkspace = randomUUID(), ownConversation = randomUUID(), otherConversation = randomUUID();
  await fixture.pool.query(
    "INSERT INTO applications (id, user_id, company_name, position_title) VALUES ($1, $2, 'Own Co', 'Engineer'), ($3, $4, 'Other Co', 'Analyst')",
    [ownApp, own, otherApp, other]);
  await fixture.pool.query(
    `INSERT INTO resumes (id, user_id, name, original_filename, object_key, mime_type, size_bytes, page_count, non_whitespace_chars, parse_status)
     VALUES ($1, $2, 'Resume', 'resume.pdf', $3, 'application/pdf', 1024, 1, 0, 'text_unavailable')`,
    [ownResume, own, `resumes/${own}/${ownResume}.pdf`]);
  await fixture.pool.query("INSERT INTO ai_workspaces (id, application_id) VALUES ($1, $2), ($3, $4)", [ownWorkspace, ownApp, otherWorkspace, otherApp]);
  await fixture.pool.query("INSERT INTO conversations (id, workspace_id) VALUES ($1, $2), ($3, $4)", [ownConversation, ownWorkspace, otherConversation, otherWorkspace]);
  const read = (path: string) => fetch(base + path, { headers: { cookie, origin } });
  assert.equal((await fetch(base + `/api/v1/applications/${ownApp}`)).status, 401);
  assert.equal((await read(`/api/v1/applications/${ownApp}`)).status, 200);
  assert.equal((await read(`/api/v1/applications/${otherApp}?userId=${other}&emailVerified=true`)).status, 404);
  assert.equal((await read(`/api/v1/applications/not-a-uuid`)).status, 404);
  assert.equal((await read(`/api/v1/workspaces/${ownWorkspace}`)).status, 200);
  assert.equal((await read(`/api/v1/workspaces/${otherWorkspace}`)).status, 404);
  assert.equal((await read(`/api/v1/conversations/${ownConversation}`)).status, 200);
  assert.equal((await read(`/api/v1/conversations/${otherConversation}`)).status, 404);
  assert.equal((await read(`/api/v1/resumes/${ownResume}`)).status, 200);
  await fixture.pool.query("UPDATE resumes SET deleted_at=NOW() WHERE id=$1", [ownResume]);
  assert.equal((await read(`/api/v1/resumes/${ownResume}`)).status, 404);
  await fixture.pool.query('UPDATE auth_user SET "emailVerified"=false WHERE id=$1', [registeredBody.user.id]);
  const unverified = await read(`/api/v1/applications/${ownApp}`);
  assert.equal(unverified.status, 403);
  assert.equal((await unverified.json() as { error: { code: string } }).error.code, "EMAIL_NOT_VERIFIED");
  const csrf = await fetch(base + "/api/v1/not-an-action", { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  assert.equal(csrf.status, 403);
  assert.equal(csrf.headers.get("access-control-allow-origin"), null);
  assert.equal((await fetch(base + "/health")).status, 200);
});

test("native failed-login counters survive rollback and client IP headers cannot bypass them", { timeout: 30000 }, async t => {
  const fixture = await createAuthFixture({ nativeRateLimitEnabled: true });
  const email = uniqueEmail();
  const registration = await fixture.request("/api/auth/sign-up/email", {
    body: { name: "Rate test", email, password: "correct-password-123", emailVerified: true, userId: randomUUID() },
  });
  assert.equal(registration.status, 200);
  const created = await registration.json() as { user: { emailVerified: boolean }; token: unknown };
  assert.equal(created.user.emailVerified, false);
  assert.equal(created.token, null);
  const verified = await fixture.request(verificationUrl(fixture.emails[0]!, { callbackURL: null }));
  assert.equal(verified.status, 200);
  const app = createApp({ authentication: fixture.authentication, database: fixture.database,
    environment: { auth: fixture.config, trustProxyHops: 0 } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fixture.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(base + "/api/auth/sign-in/email", {
      method: "POST", headers: { origin: "http://localhost:5173", "content-type": "application/json", "x-jobflow-client-ip": `192.0.2.${attempt + 1}`, "x-forwarded-for": `198.51.100.${attempt + 1}` },
      body: JSON.stringify({ email, password: "wrong-password-123" }),
    });
    assert.equal(response.status, attempt < 3 ? 401 : 429);
    await response.arrayBuffer();
  }
  assert.equal((await fixture.pool.query("SELECT count(*)::int AS count FROM auth_session")).rows[0]!.count, 1);
});

test("the resume router runs behind real Sessions, verification, origin checks and owner scoping", { timeout: 30000 }, async t => {
  const fixture = await createAuthFixture();
  const cleanup = new FakeCleanupRepository();
  const resumes = new FakeResumeRepository(cleanup);
  const service = createResumeService({ pool: {} as Pool, storage: new FakeStorage(), pdf: fakeExtractor(extraction()), resumes, cleanup, log: () => {} });
  const businessRouter = Router();
  businessRouter.use("/resumes", createResumeRouter({ service, authenticate: requireAuthContext, log: () => {} }));
  const app = createApp({ authentication: fixture.authentication, database: fixture.database,
    environment: { auth: fixture.config, trustProxyHops: 0 }, businessRouter });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fixture.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/resumes`;
  const origin = "http://localhost:5173";
  const owner = await verifiedUser(fixture);
  const other = await verifiedUser(fixture);
  const upload = (cookie: string, from = origin) => {
    const body = new FormData();
    body.append("name", "Backend resume");
    body.append("file", new Blob([pdfBytes()], { type: "application/pdf" }), "cv.pdf");
    return fetch(base, { method: "POST", headers: { cookie, origin: from }, body });
  };

  assert.equal((await fetch(base, { headers: { origin } })).status, 401);
  const forged = await upload(owner.cookie, "https://evil.example");
  assert.equal(forged.status, 403);
  assert.equal(resumes.rows.size, 0);

  const created = await upload(owner.cookie);
  assert.equal(created.status, 201);
  assert.match(created.headers.get("access-control-expose-headers") ?? "", /Location/);
  const resume = await created.json() as { id: string };
  assert.equal(resumes.rows.get(resume.id)?.userId, owner.id);

  const listed = await fetch(base, { headers: { cookie: owner.cookie, origin } });
  assert.deepEqual((await listed.json() as { data: { id: string }[] }).data.map(row => row.id), [resume.id]);
  assert.equal((await fetch(`${base}/${resume.id}`, { headers: { cookie: other.cookie, origin } })).status, 404);

  await fixture.pool.query('UPDATE auth_user SET "emailVerified" = false WHERE id = $1', [owner.id]);
  const unverified = await fetch(base, { headers: { cookie: owner.cookie, origin } });
  assert.equal(unverified.status, 403);
  assert.equal((await unverified.json() as { error: { code: string } }).error.code, "EMAIL_NOT_VERIFIED");
});
