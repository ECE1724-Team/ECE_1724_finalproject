import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { promisify } from "node:util";
import express, { type RequestHandler } from "express";
import { createPdfExtractor } from "../../src/integrations/pdf/extractor.js";
import { createPostgresApplicationRepository } from "../../src/modules/applications/postgres-repository.js";
import { mountPostgresResumeRoutes } from "../../src/modules/resumes/postgres-routes.js";
import { FakeStorage } from "../fakes/resumes.js";
import { makePdf } from "../fixtures/pdf.js";
import { newApplication, savedApplication } from "../helpers/applications.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

test("mounted resume routes preserve private access and clean up after an HTTP delete", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first, second } = await insertTestOwners(pool);
  const storage = new FakeStorage();
  const users = new Map([["Bearer first", first.id], ["Bearer second", second.id]]);
  const authenticate: RequestHandler = (req, res, next) => {
    const userId = users.get(req.get("authorization") ?? "");
    if (!userId) {
      res.sendStatus(401);
      return;
    }
    res.locals.auth = { userId, sessionId: `test-session-${userId}`, emailVerified: true };
    next();
  };
  const app = express();
  const startWorker = mountPostgresResumeRoutes(app, { pool, storage, pdf: createPdfExtractor(), authenticate });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/v1/resumes`;
    const firstHeaders = { authorization: "Bearer first" };
    const secondHeaders = { authorization: "Bearer second" };
    assert.equal((await fetch(base)).status, 401);

    const bytes = makePdf();
    const form = new FormData();
    form.append("name", "Example CV");
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "cv.pdf");
    const uploaded = await fetch(base, { method: "POST", headers: firstHeaders, body: form });
    assert.equal(uploaded.status, 201);
    const resume = await uploaded.json() as { id: string; textStatus: string; linkedApplicationCount: number };
    assert.equal(resume.textStatus, "available");
    assert.equal(resume.linkedApplicationCount, 0);
    assert.equal("objectKey" in resume, false);

    const url = `${base}/${resume.id}`;
    assert.deepEqual(await (await fetch(base, { headers: secondHeaders })).json(), { data: [] });
    assert.equal((await fetch(url, { headers: secondHeaders })).status, 404);
    assert.equal((await fetch(`${url}/file`, { headers: secondHeaders })).status, 404);
    assert.equal((await fetch(url, { method: "DELETE", headers: secondHeaders })).status, 404);

    const downloaded = await fetch(`${url}/file`, { headers: firstHeaders });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);

    const applications = createPostgresApplicationRepository();
    const application = savedApplication(await applications.insert(pool, newApplication(first.id, { resumeId: resume.id })));
    const { rows: [saved] } = await pool.query<{ object_key: string; extracted_text: string }>(`
      SELECT object_key, extracted_text FROM public.resumes WHERE id = $1
    `, [resume.id]);
    assert.match(saved.extracted_text, /Alex Example/);
    assert.equal((await (await fetch(url, { headers: firstHeaders })).json() as typeof resume).linkedApplicationCount, 1);

    const deleted = await fetch(url, { method: "DELETE", headers: firstHeaders });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { unlinkedApplicationCount: 1 });
    const unlinked = await applications.get(pool, first.id, application.id);
    assert.equal(unlinked?.resumeId, null);
    assert.equal(unlinked?.rowVersion, "2");
    assert.equal((await fetch(`${url}/file`, { headers: firstHeaders })).status, 404);
    assert.ok(await storage.head(saved.object_key));

    await startWorker().stop();
    assert.equal(await storage.head(saved.object_key), null);
    const { rows } = await pool.query(`
      SELECT reason, status FROM public.storage_cleanup_jobs WHERE object_key = $1
    `, [saved.object_key]);
    assert.deepEqual(rows, [{ reason: "resume_deleted", status: "done" }]);
  } finally {
    await promisify(server.close).call(server);
  }
}));
