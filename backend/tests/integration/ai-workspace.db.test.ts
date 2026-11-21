import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { promisify } from "node:util";
import { Router } from "express";
import { createApp } from "../../src/app.js";
import { createAiRouter } from "../../src/modules/ai/routes.js";
import { createPostgresApplicationRepository } from "../../src/modules/applications/postgres-repository.js";
import type { NewApplication } from "../../src/modules/applications/repository.js";
import { insertResume, newApplication, savedApplication } from "../helpers/applications.js";
import { createAuthFixture, verifiedUser, type AuthFixture } from "../helpers/auth-fixture.js";

const applications = createPostgresApplicationRepository();
const origin = "http://localhost:5173";

async function startServer(t: { after: (fn: () => Promise<void>) => void }) {
  const fixture = await createAuthFixture();
  const businessRouter = Router();
  businessRouter.use(createAiRouter({ pool: fixture.pool }));
  const app = createApp({ authentication: fixture.authentication, database: fixture.database,
    environment: { auth: fixture.config, trustProxyHops: 0 }, businessRouter });
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    try { await promisify(server.close).call(server); }
    finally { await fixture.close(); }
  });
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = (path: string, cookie: string | null, method = "GET") => {
    const headers = new Headers({ origin });
    if (cookie) headers.set("cookie", cookie);
    return fetch(base + path, { method, headers });
  };
  return { fixture, call };
}

async function json<T>(response: Response, status: number): Promise<T> {
  assert.equal(response.status, status);
  return await response.json() as T;
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal((await json<{ error: { code: string } }>(response, status)).error.code, code);
}

async function countAiRows(fixture: AuthFixture) {
  const { rows: [counts] } = await fixture.pool.query(`
    SELECT (SELECT count(*)::int FROM public.generation_runs) AS generations,
           (SELECT count(*)::int FROM public.material_snapshots) AS snapshots,
           (SELECT count(*)::int FROM public.messages) AS messages,
           (SELECT count(*)::int FROM public.conversation_summaries) AS summaries
  `);
  return counts;
}

interface Workspace { id: string; applicationId: string; companyName: string; jobTitle: string;
  linkedResume: { id: string; name: string; contentVersion: string } | null;
  materials: Record<string, { kind: string; fingerprint: string; availability: string; sourceResumeId: string | null; reasonCode: string | null }> }
interface Conversation { id: string; workspaceId: string; title: string | null; activeGenerationId: string | null; materialState: object }
interface Message { id: string; sequenceNo: string; role: string; parts: { type: string; text: string }[] }

test("AI workspaces: position search, workspace reuse, independent conversations and access checks", { timeout: 60_000 }, async (t) => {
  const { fixture, call } = await startServer(t);
  const { pool } = fixture;
  const owner = await verifiedUser(fixture);
  const other = await verifiedUser(fixture);
  const insert = async (userId: string, fields: Partial<NewApplication>) =>
    savedApplication(await applications.insert(pool, newApplication(userId, fields)));

  const acme = await insert(owner.id, { companyName: "Acme", positionTitle: "Backend Engineer", status: "applied" });
  const globex = await insert(owner.id, { companyName: "Globex", positionTitle: "Data Analyst", status: "interview" });
  const labs = await insert(owner.id, { companyName: "Initech", positionTitle: "ACME tooling dev", status: "interview" });
  const foreign = await insert(other.id, { companyName: "Acme", positionTitle: "Backend Engineer" });

  // Anonymous, untrusted origin and unverified access.
  await expectError(await call("/ai/applications", null), 401, "UNAUTHORIZED");
  const unverified = await verifiedUser(fixture);
  await pool.query('UPDATE public.auth_user SET "emailVerified" = false WHERE id = $1', [unverified.id]);
  await expectError(await call("/ai/applications", unverified.cookie), 403, "EMAIL_NOT_VERIFIED");
  await expectError(await call(`/applications/${acme.id}/ai-workspace`, unverified.cookie, "PUT"), 403, "EMAIL_NOT_VERIFIED");

  // Search and status filters combine, over the user's own applications only.
  type Options = { data: { id: string; companyName: string; jobTitle: string; status: string }[] };
  const list = async (query: string) => (await json<Options>(await call(`/ai/applications${query}`, owner.cookie), 200)).data;
  assert.deepEqual((await list("")).map((a) => a.id), [labs.id, globex.id, acme.id]);
  assert.deepEqual(await list("?q=acme"), [
    { id: labs.id, companyName: "Initech", jobTitle: "ACME tooling dev", status: "interview" },
    { id: acme.id, companyName: "Acme", jobTitle: "Backend Engineer", status: "applied" },
  ]);
  assert.deepEqual((await list("?q=aCmE&status=interview")).map((a) => a.id), [labs.id]);
  assert.deepEqual(await list("?status=offer"), []);
  assert.deepEqual(await list("?q=%25"), [], "% is a literal, not a wildcard");
  assert.deepEqual(await list("?q=nothing&status=applied"), []);
  assert.equal((await list("?q=%20&status=")).length, 3, "blank values filter nothing, as in the application list");
  await expectError(await call("/ai/applications?status=archived", owner.cookie), 400, "BAD_REQUEST");
  await expectError(await call("/ai/applications?q=a&q=b", owner.cookie), 400, "BAD_REQUEST");
  assert.deepEqual((await json<Options>(await call("/ai/applications", other.cookie), 200)).data.map((a) => a.id), [foreign.id]);

  // Opening an application twice reuses its one workspace.
  const opened = await json<Workspace>(await call(`/applications/${acme.id}/ai-workspace`, owner.cookie, "PUT"), 200);
  const reopened = await json<Workspace>(await call(`/applications/${acme.id}/ai-workspace`, owner.cookie, "PUT"), 200);
  assert.deepEqual(reopened, opened);
  assert.equal(opened.applicationId, acme.id);
  assert.equal(opened.companyName, "Acme");
  assert.equal(opened.jobTitle, "Backend Engineer");
  assert.equal(opened.linkedResume, null);
  assert.deepEqual(Object.keys(opened.materials), ["resume", "jd", "company", "position", "company_website_url", "company_notes"]);
  assert.deepEqual(opened.materials.resume, {
    kind: "resume", fingerprint: opened.materials.resume.fingerprint, availability: "unavailable",
    sourceResumeId: null, reasonCode: "RESUME_NOT_LINKED",
  });
  assert.equal(opened.materials.jd.reasonCode, "FIELD_MISSING");
  assert.equal(opened.materials.company.availability, "available");
  assert.match(opened.materials.company.fingerprint, /^v1:[0-9a-f]{64}$/);
  const { rows: workspaces } = await pool.query("SELECT id FROM public.ai_workspaces");
  assert.deepEqual(workspaces, [{ id: opened.id }]);
  assert.deepEqual(await json(await call(`/ai/workspaces/${opened.id}`, owner.cookie), 200), opened);

  // A linked resume shows up as metadata only.
  const resume = await insertResume(pool, owner.id);
  savedApplication(await applications.update(pool, owner.id, acme.id, undefined, { resumeId: resume.id, jobDescription: "Build APIs" }));
  const withResume = await json<Workspace>(await call(`/ai/workspaces/${opened.id}`, owner.cookie), 200);
  assert.deepEqual(withResume.linkedResume, { id: resume.id, name: "Example resume", contentVersion: "1" });
  assert.equal(withResume.materials.resume.availability, "available");
  assert.equal(withResume.materials.resume.sourceResumeId, resume.id);
  assert.equal(withResume.materials.jd.availability, "available");
  assert.equal("contentText" in withResume.materials.resume, false);

  // Conversations are created only on request and start empty.
  const conversationsPath = `/ai/workspaces/${opened.id}/conversations`;
  assert.deepEqual(await json(await call(conversationsPath, owner.cookie), 200), { data: [] });
  const created = await call(conversationsPath, owner.cookie, "POST");
  const first = await json<Conversation>(created, 201);
  assert.equal(created.headers.get("location"), `/api/v1/ai/conversations/${first.id}`);
  assert.equal(first.workspaceId, opened.id);
  assert.equal(first.title, null);
  assert.equal(first.activeGenerationId, null);
  assert.deepEqual(first.materialState, {});
  const second = await json<Conversation>(await call(conversationsPath, owner.cookie, "POST"), 201);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(await json(await call(`/ai/conversations/${first.id}`, owner.cookie), 200), first);
  assert.deepEqual((await json<{ data: Conversation[] }>(await call(conversationsPath, owner.cookie), 200)).data.map((c) => c.id).sort(),
    [first.id, second.id].sort());
  assert.deepEqual(await json(await call(`/ai/conversations/${first.id}/messages`, owner.cookie), 200), { data: [] });

  // Browsing positions, entering a workspace and creating conversations call nothing else.
  assert.deepEqual(await countAiRows(fixture), { generations: 0, snapshots: 0, messages: 0, summaries: 0 });

  // Each conversation keeps its own history, in numeric (not lexicographic) sequence order.
  const seed = (conversationId: string, sequenceNo: number, text: string) => pool.query(`
    INSERT INTO public.messages (conversation_id, sequence_no, role, parts) VALUES ($1, $2, 'user', $3)
  `, [conversationId, sequenceNo, JSON.stringify([{ type: "text", text }])]);
  await seed(first.id, 10, "ten");
  await seed(first.id, 2, "two");
  await seed(first.id, 9, "nine");
  await seed(second.id, 1, "other thread");
  const history = (await json<{ data: Message[] }>(await call(`/ai/conversations/${first.id}/messages`, owner.cookie), 200)).data;
  assert.deepEqual(history.map((m) => [m.sequenceNo, m.parts[0].text]), [["2", "two"], ["9", "nine"], ["10", "ten"]]);
  const otherHistory = (await json<{ data: Message[] }>(await call(`/ai/conversations/${second.id}/messages`, owner.cookie), 200)).data;
  assert.deepEqual(otherHistory.map((m) => m.parts[0].text), ["other thread"]);

  // Another user's resources, and malformed IDs, are not found.
  for (const [path, method] of [
    [`/applications/${acme.id}/ai-workspace`, "PUT"],
    [`/ai/workspaces/${opened.id}`, "GET"],
    [conversationsPath, "GET"],
    [conversationsPath, "POST"],
    [`/ai/conversations/${first.id}`, "GET"],
    [`/ai/conversations/${first.id}/messages`, "GET"],
    ["/applications/not-a-uuid/ai-workspace", "PUT"],
    ["/ai/conversations/not-a-uuid", "GET"],
  ]) {
    await expectError(await call(path, other.cookie, method), 404, "NOT_FOUND");
  }
  const { rows: [{ count }] } = await pool.query("SELECT count(*)::int AS count FROM public.conversations");
  assert.equal(count, 2, "a rejected create inserts nothing");
});
