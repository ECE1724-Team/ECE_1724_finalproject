import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { promisify } from "node:util";
import { Router } from "express";
import { createApp } from "../../src/app.js";
import { StorageError } from "../../src/integrations/object-storage/types.js";
import { createPdfExtractor } from "../../src/integrations/pdf/extractor.js";
import { createPostgresApplicationRepository } from "../../src/modules/applications/postgres-repository.js";
import { MAX_RESUME_BYTES } from "../../src/modules/resumes/pdf-policy.js";
import { mountPostgresResumeRoutes } from "../../src/modules/resumes/postgres-routes.js";
import type { toPublicResume } from "../../src/modules/resumes/routes.js";
import { FakeStorage, collectLogs } from "../fakes/resumes.js";
import { makePasswordProtectedPdf, makePdf, makeSplitThresholdPdf, textPage } from "../fixtures/pdf.js";
import { newApplication, savedApplication } from "../helpers/applications.js";
import { createAuthFixture, sessionCookie, uniqueEmail, verificationUrl, type AuthFixture } from "../helpers/auth-fixture.js";

type Resume = ReturnType<typeof toPublicResume>;

async function verifiedUser(fixture: AuthFixture) {
  const registered = await fixture.request("/api/auth/sign-up/email", {
    body: { name: "Resume owner", email: uniqueEmail(), password: "a-strong-password-123" },
  });
  assert.equal(registered.status, 200);
  const { user } = await registered.json() as { user: { id: string } };
  const verified = await fixture.request(verificationUrl(fixture.emails.at(-1)!, { callbackURL: null }));
  assert.equal(verified.status, 200);
  const cookie = sessionCookie(verified);
  assert.ok(cookie);
  return { id: user.id, cookie };
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal((await response.json() as { error: { code: string } }).error.code, code);
}

test("the startup resume routes use real sessions, PDF extraction and PostgreSQL", { timeout: 30_000 }, async t => {
  const fixture = await createAuthFixture();
  const { authentication, database, pool, config } = fixture;
  const storage = new FakeStorage();
  const { log } = collectLogs();
  const businessRouter = Router();
  const startWorker = mountPostgresResumeRoutes(businessRouter, { pool, storage, pdf: createPdfExtractor(), log });
  const app = createApp({ authentication, database,
    environment: { auth: config, trustProxyHops: 0 }, businessRouter });
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    try { await promisify(server.close).call(server); }
    finally { await fixture.close(); }
  });
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1/resumes`;
  const owner = await verifiedUser(fixture);
  const other = await verifiedUser(fixture);
  const origin = "http://localhost:5173";
  const call = (path: string, { cookie = owner.cookie, ...init }: RequestInit & { cookie?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", origin);
    if (cookie) headers.set("cookie", cookie);
    return fetch(base + path, { ...init, headers });
  };
  const upload = (bytes: Uint8Array, from = origin) => {
    const body = new FormData();
    body.append("name", "Example CV");
    body.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "cv.pdf");
    return call("", { method: "POST", headers: { origin: from }, body });
  };
  const countRows = async () => (await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.resumes",
  )).rows[0].count;

  await expectError(await call("", { cookie: null }), 401, "UNAUTHORIZED");
  await expectError(await upload(makePdf(), "https://untrusted.example"), 403, "FORBIDDEN");
  await expectError(await upload(makePasswordProtectedPdf()), 422, "PDF_PASSWORD_PROTECTED");
  await expectError(await upload(makePdf([textPage()], { size: MAX_RESUME_BYTES + 1 })), 413, "PDF_TOO_LARGE");
  assert.equal(await countRows(), 0);
  assert.deepEqual(storage.calls, []);

  const bytes = makePdf([textPage()], { size: MAX_RESUME_BYTES });
  const uploaded = await upload(bytes);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.headers.get("access-control-allow-origin"), origin);
  assert.match(uploaded.headers.get("access-control-expose-headers") ?? "", /Location/);
  const resume = await uploaded.json() as Resume;
  const path = `/${resume.id}`;
  assert.equal(uploaded.headers.get("location"), `/api/v1/resumes${path}`);
  assert.equal(resume.textStatus, "available");
  assert.equal(resume.sizeBytes, MAX_RESUME_BYTES);
  assert.equal(resume.linkedApplicationCount, 0);
  assert.equal("objectKey" in resume, false);

  const listed = await call("");
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { data: [resume] });
  const metadata = await call(path);
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), resume);
  assert.deepEqual(await (await call("", { cookie: other.cookie })).json(), { data: [] });
  await expectError(await call(path, { cookie: other.cookie }), 404, "NOT_FOUND");
  await expectError(await call(`${path}/file`, { cookie: other.cookie }), 404, "NOT_FOUND");
  await expectError(await call(path, { method: "DELETE", cookie: other.cookie }), 404, "NOT_FOUND");

  // A real session whose user is now unverified must fail the next request.
  await pool.query('UPDATE public.auth_user SET "emailVerified" = false WHERE id = $1', [other.id]);
  await expectError(await call("", { cookie: other.cookie }), 403, "EMAIL_NOT_VERIFIED");

  const downloaded = await call(`${path}/file`);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/pdf");
  assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);

  const split = await upload(makeSplitThresholdPdf());
  assert.equal(split.status, 201);
  assert.equal((await split.json() as Resume).textStatus, "available");
  const scan = await upload(makePdf([{ runs: [], image: true }]));
  assert.equal(scan.status, 201);
  const scanResume = await scan.json() as Resume;
  assert.equal(scanResume.textStatus, "unavailable");
  const { rows } = await pool.query(`
    SELECT parse_status, extracted_text FROM public.resumes WHERE id = $1
  `, [scanResume.id]);
  assert.deepEqual(rows, [{ parse_status: "text_unavailable", extracted_text: null }]);

  const applications = createPostgresApplicationRepository();
  const application = savedApplication(await applications.insert(pool, newApplication(owner.id, { resumeId: resume.id })));
  const { rows: [saved] } = await pool.query<{ object_key: string; extracted_text: string }>(`
    SELECT object_key, extracted_text FROM public.resumes WHERE id = $1
  `, [resume.id]);
  assert.match(saved.extracted_text, /Alex Example/);

  const storageOutage = new StorageError("timeout");
  storage.putError = storage.deleteError = storageOutage;
  storage.beforeRead = () => { throw storageOutage; };
  await expectError(await upload(makePdf()), 503, "SERVICE_UNAVAILABLE");
  await expectError(await call(`${path}/file`), 503, "SERVICE_UNAVAILABLE");
  assert.equal(await countRows(), 3);
  assert.equal(storage.objects.size, 3);
  const metadataDuringOutage = await call(path);
  assert.equal(metadataDuringOutage.status, 200);
  assert.equal((await metadataDuringOutage.json() as Resume).linkedApplicationCount, 1);

  const deleted = await call(path, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { unlinkedApplicationCount: 1 });
  const unlinked = await applications.get(pool, owner.id, application.id);
  assert.equal(unlinked?.resumeId, null);
  assert.equal(unlinked?.rowVersion, "2");
  await expectError(await call(`${path}/file`), 404, "NOT_FOUND");
  assert.ok(storage.objects.has(saved.object_key));

  storage.deleteError = undefined;
  await startWorker().stop();
  assert.equal(storage.objects.has(saved.object_key), false);
  assert.equal(storage.objects.size, 2);
  const jobs = await pool.query(`
    SELECT reason, status FROM public.storage_cleanup_jobs WHERE object_key = $1
  `, [saved.object_key]);
  assert.deepEqual(jobs.rows, [{ reason: "resume_deleted", status: "done" }]);

  assert.equal((await fixture.request("/api/auth/sign-out", { cookie: owner.cookie, body: {} })).status, 200);
  await expectError(await call(""), 401, "UNAUTHORIZED");
});
