import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../../src/app.js";
import { createPostgresApplicationService } from "../../src/modules/applications/postgres-module.js";
import { createApplicationRouter } from "../../src/modules/applications/routes.js";
import type { ApplicationListResource, ApplicationResource } from "../../src/modules/applications/types.js";
import { insertResume } from "../helpers/applications.js";
import { createAuthFixture, sessionCookie, uniqueEmail, verificationUrl, type AuthFixture } from "../helpers/auth-fixture.js";
import { insertConversation, insertGeneration, insertWorkspace } from "../helpers/conversations.js";

const ORIGIN = "http://localhost:5173";

async function verifiedUser(fixture: AuthFixture): Promise<{ id: string; cookie: string }> {
  const registered = await fixture.request("/api/auth/sign-up/email", { body: { name: "Applicant", email: uniqueEmail(), password: "a-strong-password-123" } });
  const { user } = await registered.json() as { user: { id: string } };
  const verified = await fixture.request(verificationUrl(fixture.emails.at(-1)!, { callbackURL: null }));
  const cookie = sessionCookie(verified);
  assert.ok(cookie);
  return { id: user.id, cookie };
}

/** The application routes behind real Sessions, verification and origin checks, on real PostgreSQL. */
async function serve(t: test.TestContext) {
  const fixture = await createAuthFixture();
  const businessRouter = Router();
  businessRouter.use("/applications", createApplicationRouter({ service: createPostgresApplicationService(fixture.pool) }));
  const app = createApp({ authentication: fixture.authentication, database: fixture.database,
    environment: { auth: fixture.config, trustProxyHops: 0 }, businessRouter });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await fixture.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/applications`;
  const client = (cookie: string) => ({
    call: (method: string, path = "", body?: unknown, origin = ORIGIN) => fetch(base + path, {
      method,
      headers: { cookie, origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  });
  return { fixture, base, client };
}

async function json<T>(response: Response, status: number): Promise<T> {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function errorCode(response: Response, status: number): Promise<string> {
  return (await json<{ error: { code: string } }>(response, status)).error.code;
}

test("create, read and list applications with search, filters, sort and complete counts", { timeout: 30_000 }, async (t) => {
  const { fixture, base, client } = await serve(t);
  const owner = await verifiedUser(fixture);
  const api = client(owner.cookie).call;

  assert.equal((await fetch(base, { headers: { origin: ORIGIN } })).status, 401);
  const forged = await api("POST", "", { companyName: "Evil", jobTitle: "Forged" }, "https://evil.example");
  assert.equal(forged.status, 403);

  // Minimal create: only company and position (FR-04).
  const minimal = await api("POST", "", { companyName: "  North Labs ", jobTitle: "Backend Engineer" });
  const created = await json<ApplicationResource>(minimal, 201);
  assert.equal(minimal.headers.get("location"), `/api/v1/applications/${created.id}`);
  assert.deepEqual({ ...created, id: undefined, createdAt: undefined, updatedAt: undefined }, {
    id: undefined, companyName: "North Labs", jobTitle: "Backend Engineer", status: "saved", appliedDate: null,
    jobDescription: null, jobUrl: null, resumeId: null, resumeName: null, companyWebsiteUrl: null, companyNotes: null,
    notes: null, offerReceived: false, interviews: [], statusHistory: [], rowVersion: "1", createdAt: undefined, updatedAt: undefined,
  });

  // Full create with a resume, an offer and interviews.
  const resume = await insertResume(fixture.pool, owner.id);
  const full = await json<ApplicationResource>(await api("POST", "", {
    companyName: "south co", jobTitle: "Platform 100% _Tools!", status: "offer", appliedDate: "2026-10-28",
    jobUrl: "https://example.com/jobs/1", resumeId: resume.id, notes: "personal", companyNotes: "about them",
    interviews: [{ type: "Technical", scheduledAt: "2026-11-12T15:00:00Z" }, { type: "HR", scheduledAt: "2026-11-10T15:00:00Z" }],
  }), 201);
  assert.equal(full.offerReceived, true, "creating in Offer records the offer");
  assert.equal(full.resumeName, "Example resume");
  assert.deepEqual(full.interviews.map((interview) => interview.type), ["HR", "Technical"], "ordered by time");
  assert.equal(full.appliedDate, "2026-10-28");

  assert.deepEqual(await json(await api("GET", `/${full.id}`), 200), full);

  const list = (query = "") => api("GET", query).then((response) => json<ApplicationListResource>(response, 200));
  const all = await list();
  assert.deepEqual(all.data.map((row) => row.id), [full.id, created.id], "newest first");
  assert.deepEqual(all.counts, { total: 2, byStatus: { saved: 1, applied: 0, oa: 0, interview: 0, offer: 1, rejected: 0 } });
  assert.deepEqual(Object.keys(all.data[0]!).sort(), ["appliedDate", "companyName", "createdAt", "id", "jobTitle", "resumeId", "resumeName", "status"]);
  assert.deepEqual((await list("?sort=company")).data.map((row) => row.companyName), ["North Labs", "south co"]);
  assert.deepEqual((await list("?q=NORTH")).data.map((row) => row.id), [created.id], "case-insensitive company search");
  assert.deepEqual((await list("?q=%25")).data.map((row) => row.id), [full.id], "% is a literal character");
  const filtered = await list("?q=north&status=offer");
  assert.deepEqual(filtered.data, [], "search and status combine");
  assert.deepEqual(filtered.counts, all.counts, "counts ignore q and status");
  assert.equal(await errorCode(await api("GET", "?status=interviewing"), 400), "BAD_REQUEST");

  // Validation and resume ownership.
  assert.equal(await errorCode(await api("POST", "", { companyName: "Acme" }), 422), "VALIDATION_ERROR");
  assert.equal(await errorCode(await api("POST", "", { companyName: "Acme", jobTitle: "X", location: "Toronto" }), 422), "VALIDATION_ERROR");
  const bad = await fetch(base, { method: "POST", headers: { cookie: owner.cookie, origin: ORIGIN, "content-type": "application/json" }, body: "{oops" });
  assert.equal(await errorCode(bad, 400), "BAD_REQUEST");
  const other = await verifiedUser(fixture);
  const foreignResume = await insertResume(fixture.pool, other.id);
  assert.equal(await errorCode(await api("POST", "", { companyName: "A", jobTitle: "B", resumeId: foreignResume.id }), 422), "VALIDATION_ERROR");

  // Another user sees nothing of the owner's data.
  const stranger = client(other.cookie).call;
  assert.equal(await errorCode(await stranger("GET", `/${full.id}`), 404), "NOT_FOUND");
  assert.equal(await errorCode(await stranger("GET", "/not-a-uuid"), 404), "NOT_FOUND");
  assert.deepEqual((await json<ApplicationListResource>(await stranger("GET"), 200)).counts.total, 0);
  assert.equal((await fixture.pool.query("SELECT count(*)::int AS n FROM applications")).rows[0].n, 2, "rejected creates stored nothing");
});

test("PUT replaces the application, keeps interview identity, records status history and detects conflicts", { timeout: 30_000 }, async (t) => {
  const { fixture, client } = await serve(t);
  const owner = await verifiedUser(fixture);
  const api = client(owner.cookie).call;
  const created = await json<ApplicationResource>(await api("POST", "", {
    companyName: "Acme", jobTitle: "Engineer", jobUrl: "https://example.com/job", notes: "keep?",
    interviews: [{ type: "HR", scheduledAt: "2026-11-10T15:00:00Z" }, { type: "Tech 1", scheduledAt: "2026-11-11T15:00:00Z" }],
  }), 201);
  const [hr, tech] = created.interviews;

  const replaced = await json<ApplicationResource>(await api("PUT", `/${created.id}`, {
    companyName: "Acme", jobTitle: "Senior Engineer", status: "interview", rowVersion: created.rowVersion,
    interviews: [{ id: tech!.id, type: "Tech 1 (moved)", scheduledAt: "2026-11-12T15:00:00Z" }, { type: "Onsite", scheduledAt: "2026-11-20T15:00:00Z" }],
  }), 200);
  assert.equal(replaced.jobTitle, "Senior Engineer");
  assert.equal(replaced.jobUrl, null, "omitted optional fields are cleared");
  assert.equal(replaced.notes, null);
  assert.equal(replaced.rowVersion, "2");
  assert.equal(replaced.interviews.length, 2);
  assert.ok(!replaced.interviews.some((interview) => interview.id === hr!.id), "an interview left out is deleted");
  assert.deepEqual(replaced.interviews[0], { id: tech!.id, type: "Tech 1 (moved)", scheduledAt: "2026-11-12T15:00:00.000Z" }, "identity kept");
  assert.deepEqual(replaced.statusHistory.map(({ fromStatus, toStatus }) => [fromStatus, toStatus]), [["saved", "interview"]]);

  // Offer is recorded on entry and survives a later change (FR-06).
  const offered = await json<ApplicationResource>(await api("PUT", `/${created.id}`, { ...replaced, status: "offer", offerReceived: false }), 200);
  assert.equal(offered.offerReceived, true, "moving into Offer sets the flag even if the client sent false");
  const declined = await json<ApplicationResource>(await api("PUT", `/${created.id}`, { ...offered, status: "rejected" }), 200);
  assert.equal(declined.offerReceived, true);
  assert.deepEqual(declined.statusHistory.map(({ toStatus }) => toStatus), ["interview", "offer", "rejected"]);

  // A save of identical values changes nothing, not even the version.
  const same = await json<ApplicationResource>(await api("PUT", `/${created.id}`, declined), 200);
  assert.equal(same.rowVersion, declined.rowVersion);
  assert.equal(same.statusHistory.length, 3);

  // Stale rowVersion → 409, nothing written.
  assert.equal(await errorCode(await api("PUT", `/${created.id}`, { ...declined, jobTitle: "Stale", rowVersion: replaced.rowVersion }), 409), "VERSION_CONFLICT");
  // An interview ID from another application → 422, and the whole save rolls back.
  const sibling = await json<ApplicationResource>(await api("POST", "", {
    companyName: "Beta", jobTitle: "Dev", interviews: [{ type: "Call", scheduledAt: "2026-11-15T15:00:00Z" }],
  }), 201);
  const foreignInterview = { id: sibling.interviews[0]!.id, type: "Stolen", scheduledAt: "2026-11-15T15:00:00Z" };
  assert.equal(await errorCode(await api("PUT", `/${created.id}`, { ...declined, jobTitle: "Partial", interviews: [foreignInterview] }), 422), "VALIDATION_ERROR");
  const after = await json<ApplicationResource>(await api("GET", `/${created.id}`), 200);
  assert.deepEqual(after, same, "rejected saves left the application unchanged");

  // Linking a resume that was deleted is rejected.
  const resume = await insertResume(fixture.pool, owner.id);
  await fixture.pool.query("UPDATE resumes SET deleted_at = now() WHERE id = $1", [resume.id]);
  assert.equal(await errorCode(await api("PUT", `/${created.id}`, { ...after, resumeId: resume.id }), 422), "VALIDATION_ERROR");

  // Another user can neither read nor overwrite it.
  const other = client((await verifiedUser(fixture)).cookie).call;
  assert.equal(await errorCode(await other("PUT", `/${created.id}`, { companyName: "X", jobTitle: "Y", status: "saved" }), 404), "NOT_FOUND");
  assert.equal((await json<ApplicationResource>(await api("GET", `/${created.id}`), 200)).jobTitle, "Senior Engineer");
});

test("DELETE hard-deletes owned applications, refuses during an active AI generation, and hides others' rows", { timeout: 30_000 }, async (t) => {
  const { fixture, client } = await serve(t);
  const owner = await verifiedUser(fixture);
  const api = client(owner.cookie).call;
  const created = await json<ApplicationResource>(await api("POST", "", {
    companyName: "Acme", jobTitle: "Engineer", status: "interview", interviews: [{ type: "HR", scheduledAt: "2026-11-10T15:00:00Z" }],
  }), 201);

  const workspace = await insertWorkspace(fixture.pool, created.id);
  const conversation = await insertConversation(fixture.pool, workspace);
  const run = await insertGeneration(fixture.pool, conversation, 1, "streaming");
  assert.equal(await errorCode(await api("DELETE", `/${created.id}`), 409), "GENERATION_ACTIVE");
  assert.equal((await api("GET", `/${created.id}`)).status, 200, "nothing was deleted");

  const other = client((await verifiedUser(fixture)).cookie).call;
  assert.equal(await errorCode(await other("DELETE", `/${created.id}`), 404), "NOT_FOUND");

  await fixture.pool.query("UPDATE generation_runs SET status = 'completed', completed_at = now() WHERE id = $1", [run]);
  const deleted = await api("DELETE", `/${created.id}`);
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), "");
  assert.equal(await errorCode(await api("GET", `/${created.id}`), 404), "NOT_FOUND");
  assert.equal(await errorCode(await api("DELETE", `/${created.id}`), 404), "NOT_FOUND");
  const left = await fixture.pool.query("SELECT (SELECT count(*) FROM interviews)::int AS interviews, (SELECT count(*) FROM ai_workspaces)::int AS workspaces");
  assert.deepEqual(left.rows[0], { interviews: 0, workspaces: 0 }, "children and the AI workspace are gone");
});
