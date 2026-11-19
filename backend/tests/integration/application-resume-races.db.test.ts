import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createPostgresApplicationRepository, createPostgresInterviewRepository } from "../../src/modules/applications/postgres-repository.js";
import type { Db } from "../../src/modules/applications/repository.js";
import { insertResume, newApplication, resumes, savedApplication } from "../helpers/applications.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";
import { waitForBlockedQuery, withLockHolder } from "../helpers/lock-race.js";

const applications = createPostgresApplicationRepository();
const interviews = createPostgresInterviewRepository();

for (const save of ["create", "replace"] as const) {
  for (const firstOperation of ["application", "resume deletion"] as const) {
    test(`${save} with a resume and concurrent resume deletion: ${firstOperation} locks first`, () => withTestDatabase(async ({ pool, migrate }) => {
      await migrate();
      const { first: { id: userId } } = await insertTestOwners(pool);
      const candidate = await insertResume(pool, userId);
      const old = await insertResume(pool, userId);
      const blocking = savedApplication(await applications.insert(pool, newApplication(userId, { resumeId: candidate.id })));
      const input = newApplication(userId);
      const original = save === "replace"
        ? savedApplication(await applications.insert(pool, { ...input, resumeId: old.id }))
        : null;
      const write = (db: Db) => original
        ? applications.update(db, userId, original.id, original.rowVersion, { resumeId: candidate.id })
        : applications.insert(db, { ...input, resumeId: candidate.id });

      if (firstOperation === "application") {
        const { written, deletion } = await withLockHolder(pool, async (holder, pid, start) => {
          const written = savedApplication(await write(holder));
          const deletion = start(resumes.deleteAndUnlink(pool, userId, candidate.id));
          await waitForBlockedQuery(pool, pid, "FROM public.resumes");
          return { written, deletion };
        });
        assert.equal(written.resumeId, candidate.id);
        assert.deepEqual(await deletion, { unlinkedApplicationCount: 2 });
        const unlinked = await applications.get(pool, userId, input.id);
        assert.equal(unlinked?.resumeId, null);
        assert.equal(unlinked?.rowVersion, String(BigInt(written.rowVersion) + 1n));
      } else {
        const { deletion, writeResult } = await withLockHolder(pool, async (holder, pid, start) => {
          // Hold a linked application so deletion pauses after acquiring the candidate resume lock.
          await holder.query("SELECT id FROM public.applications WHERE id = $1 FOR UPDATE", [blocking.id]);
          const deletion = start(resumes.deleteAndUnlink(pool, userId, candidate.id));
          const deleter = await waitForBlockedQuery(pool, pid, "FROM public.applications");
          const writeResult = start(write(pool));
          await waitForBlockedQuery(pool, deleter, "FROM public.resumes");
          return { deletion, writeResult };
        });
        assert.deepEqual(await deletion, { unlinkedApplicationCount: 1 });
        assert.deepEqual(await writeResult, { outcome: "RESUME_INELIGIBLE" });
        assert.deepEqual(await applications.get(pool, userId, input.id), original && { ...original, resumeName: old.name });
      }

      assert.equal(await resumes.getLive(pool, userId, candidate.id), null);
      const unlinked = await applications.get(pool, userId, blocking.id);
      assert.equal(unlinked?.resumeId, null);
      assert.equal(unlinked?.rowVersion, "2");
      assert.deepEqual((await pool.query("SELECT id FROM public.applications WHERE resume_id = $1", [candidate.id])).rows, []);
    }));
  }
}

test("replacement reports a conflict when deletion changes the observed old link", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first: { id: userId } } = await insertTestOwners(pool);
  const old = await insertResume(pool, userId);
  const candidate = await insertResume(pool, userId);
  const original = savedApplication(await applications.insert(pool, newApplication(userId, { resumeId: old.id })));

  const { deletion, replacement } = await withLockHolder(pool, async (holder, pid, start) => {
    await holder.query("SELECT id FROM public.applications WHERE id = $1 FOR UPDATE", [original.id]);
    const deletion = start(resumes.deleteAndUnlink(pool, userId, old.id));
    const deleter = await waitForBlockedQuery(pool, pid, "FROM public.applications");
    const replacement = start(applications.update(pool, userId, original.id, undefined, { resumeId: candidate.id }));
    await waitForBlockedQuery(pool, deleter, "FROM public.resumes");
    return { deletion, replacement };
  });
  assert.deepEqual(await deletion, { unlinkedApplicationCount: 1 });
  assert.deepEqual(await replacement, { outcome: "VERSION_CONFLICT" });
  const updated = await applications.get(pool, userId, original.id);
  assert.equal(updated?.resumeId, null);
  assert.equal(updated?.rowVersion, "2");
}));

test("combined save holds the resume lock through the interview write", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first: { id: userId } } = await insertTestOwners(pool);
  const resume = await insertResume(pool, userId);
  const application = savedApplication(await applications.insert(pool, newApplication(userId)));
  const interview = { id: randomUUID(), userId, applicationId: application.id, interviewName: "Screen", startsAt: new Date() };

  const { save, deletion } = await withLockHolder(pool, async (holder, pid, start) => {
    await holder.query("LOCK TABLE public.interviews IN SHARE MODE");
    const save = start(applications.updateWithInterviews(pool, userId, application.id, application.rowVersion,
      { resumeId: resume.id }, async (client) => { assert.ok(await interviews.insert(client, interview)); }));
    const saver = await waitForBlockedQuery(pool, pid, "INSERT INTO public.interviews");
    const deletion = start(resumes.deleteAndUnlink(pool, userId, resume.id));
    await waitForBlockedQuery(pool, saver, "FROM public.resumes");
    return { save, deletion };
  });

  const saved = savedApplication(await save);
  assert.equal(saved.resumeId, resume.id);
  assert.equal(saved.rowVersion, "2");
  assert.deepEqual(await deletion, { unlinkedApplicationCount: 1 });
  assert.equal(await resumes.getLive(pool, userId, resume.id), null);
  const unlinked = await applications.get(pool, userId, application.id);
  assert.equal(unlinked?.resumeId, null);
  assert.equal(unlinked?.rowVersion, "3");
  assert.equal((await interviews.get(pool, userId, application.id, interview.id))?.interviewName, interview.interviewName);
}));

test("combined save returns a version conflict when resume deletion locks first", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first: { id: userId } } = await insertTestOwners(pool);
  const old = await insertResume(pool, userId);
  const replacement = await insertResume(pool, userId);
  const blockerId = "10000000-0000-4000-8000-000000000001";
  const applicationId = "10000000-0000-4000-8000-000000000002";
  await applications.insert(pool, newApplication(userId, { id: blockerId, resumeId: old.id }));
  const application = savedApplication(await applications.insert(pool, newApplication(userId, { id: applicationId, resumeId: old.id })));
  const interview = { id: randomUUID(), userId, applicationId, interviewName: "Screen", startsAt: new Date() };

  const { save, deletion } = await withLockHolder(pool, async (holder, pid, start) => {
    // Deletion locks linked applications in ID order, so it pauses before reaching the saved application.
    await holder.query("SELECT id FROM public.applications WHERE id = $1 FOR UPDATE", [blockerId]);
    const deletion = start(resumes.deleteAndUnlink(pool, userId, old.id));
    const deleter = await waitForBlockedQuery(pool, pid, "FROM public.applications");
    const save = start(applications.updateWithInterviews(pool, userId, applicationId, application.rowVersion,
      { resumeId: replacement.id }, async (client) => { assert.ok(await interviews.insert(client, interview)); }));
    await waitForBlockedQuery(pool, deleter, "FROM public.resumes");
    return { save, deletion };
  });

  assert.deepEqual(await deletion, { unlinkedApplicationCount: 2 });
  assert.deepEqual(await save, { outcome: "VERSION_CONFLICT" });
  const unlinked = await applications.get(pool, userId, applicationId);
  assert.equal(unlinked?.resumeId, null);
  assert.equal(unlinked?.rowVersion, "2");
  assert.deepEqual(await interviews.list(pool, userId, applicationId), []);
}));
