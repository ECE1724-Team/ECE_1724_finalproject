import assert from "node:assert/strict";
import { test } from "node:test";
import { withTransaction } from "../../src/db/transaction.js";
import { createPostgresApplicationRepository, createPostgresApplicationStatusHistoryRepository } from "../../src/modules/applications/postgres-repository.js";
import type { ApplicationStatus } from "../../src/modules/applications/repository.js";
import { insertResume, newApplication, resumes, savedApplication } from "../helpers/applications.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

const applications = createPostgresApplicationRepository();
const history = createPostgresApplicationStatusHistoryRepository();

test("application creation defaults and status edits preserve date, offer and ordered history", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first, second } = await insertTestOwners(pool);
  const input = newApplication(first.id, { companyName: "  Example Company ", positionTitle: " Engineer " });
  const created = savedApplication(await applications.insert(pool, input));
  const { createdAt, updatedAt, ...fields } = created;
  assert.ok(createdAt instanceof Date);
  assert.deepEqual(updatedAt, createdAt);
  assert.deepEqual(fields, {
    id: input.id, userId: first.id, companyName: "Example Company", positionTitle: "Engineer", status: "saved",
    appliedDate: null, jobDescription: null, resumeId: null, jobUrl: null, companyWebsiteUrl: null,
    companyNotes: null, personalNotes: null, offerReceived: false, rowVersion: "1",
  });
  assert.deepEqual(await applications.get(pool, first.id, input.id), { ...created, resumeName: null });
  assert.equal(await applications.get(pool, second.id, input.id), null);
  assert.deepEqual(await history.list(pool, first.id, input.id), []);
  assert.equal(savedApplication(await applications.insert(pool, newApplication(first.id, {
    status: "offer", offerReceived: false,
  }))).offerReceived, true); // Same company and position are allowed.

  await assert.rejects(applications.insert(pool, newApplication(first.id, { companyName: " \t " })), { code: "23514" });
  await assert.rejects(applications.insert(pool, newApplication(first.id, { positionTitle: " \n " })), { code: "23514" });
  await assert.rejects(applications.update(pool, first.id, input.id, "1", { positionTitle: " " }), { code: "23514" });
  assert.deepEqual(await applications.update(pool, second.id, input.id, "1", { status: "offer" }), { outcome: "NOT_FOUND" });

  await pool.query("UPDATE public.applications SET updated_at = '2000-01-01T00:00:00Z' WHERE id = $1", [input.id]);
  let current = savedApplication(await withTransaction(pool, async (client) => {
    await client.query("SET LOCAL TIME ZONE 'America/Toronto'");
    return applications.update(client, first.id, input.id, "1", { appliedDate: "2026-11-01", jobDescription: "  Exact JD text\n" });
  }));
  assert.equal(current.appliedDate, "2026-11-01");
  assert.equal(current.jobDescription, "  Exact JD text\n");
  assert.equal(current.rowVersion, "2");
  assert.ok(current.updatedAt > new Date("2000-01-01T00:00:00Z"));
  await withTransaction(pool, async (client) => {
    await client.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
    assert.equal((await applications.get(client, first.id, input.id))?.appliedDate, "2026-11-01");
  });
  assert.deepEqual(savedApplication(await applications.update(pool, first.id, input.id, "2", {
    companyName: " Example Company ", appliedDate: current.appliedDate, resumeId: null, personalNotes: null,
  })), current);
  assert.deepEqual(savedApplication(await applications.update(pool, first.id, input.id, "2", {})), current);

  const transitions: ApplicationStatus[] = ["applied", "oa", "interview", "offer", "rejected", "saved"];
  const expectedHistory = [];
  for (const status of transitions) {
    const previous = current;
    const changes = status === "offer" ? { status, offerReceived: false } : { status };
    current = savedApplication(await applications.update(pool, first.id, input.id, previous.rowVersion, changes));
    assert.equal(current.status, status);
    assert.equal(current.offerReceived, previous.offerReceived || status === "offer");
    assert.equal(current.rowVersion, String(BigInt(previous.rowVersion) + 1n));
    assert.ok(current.updatedAt >= previous.updatedAt);
    expectedHistory.push({ sequenceNo: String(expectedHistory.length + 1), oldStatus: previous.status, newStatus: status });
    assert.deepEqual((await history.list(pool, first.id, input.id)).map(({ sequenceNo, oldStatus, newStatus }) => (
      { sequenceNo, oldStatus, newStatus }
    )), expectedHistory);
  }
  const corrected = savedApplication(await applications.update(pool, first.id, input.id, current.rowVersion, {
    offerReceived: false, appliedDate: null, jobDescription: null,
  }));
  assert.equal(corrected.offerReceived, false);
  assert.equal(corrected.appliedDate, null);
  assert.equal(corrected.jobDescription, null);
  assert.equal(corrected.rowVersion, "9");
  assert.equal((await history.list(pool, first.id, input.id)).length, transitions.length);
  assert.deepEqual(await history.list(pool, second.id, input.id), []);
}));

test("concurrent application saves use lossless versions and a failed history write rolls the edit back", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first } = await insertTestOwners(pool);
  const { id } = savedApplication(await applications.insert(pool, newApplication(first.id)));
  const highVersion = "9007199254740993";
  await pool.query("UPDATE public.applications SET row_version = $2 WHERE id = $1", [id, highVersion]);
  await pool.query(`
    INSERT INTO public.application_status_history (application_id, sequence_no, old_status, new_status)
    VALUES ($1, 2, 'applied', 'rejected'), ($1, $2, 'rejected', 'saved')
  `, [id, highVersion]);
  assert.equal((await applications.get(pool, first.id, id))?.rowVersion, highVersion);

  const results = await Promise.all([
    applications.update(pool, first.id, id, highVersion, { status: "applied" }),
    applications.update(pool, first.id, id, highVersion, { status: "interview" }),
  ]);
  assert.deepEqual(results.map(({ outcome }) => outcome).sort(), ["OK", "VERSION_CONFLICT"]);
  const committed = savedApplication(results.find(({ outcome }) => outcome === "OK")!);
  assert.equal(committed.rowVersion, "9007199254740994");
  const events = await history.list(pool, first.id, id);
  assert.deepEqual(events.map(({ sequenceNo }) => sequenceNo), ["2", highVersion, committed.rowVersion]);
  assert.equal(events.at(-1)?.newStatus, committed.status);

  await pool.query("ALTER TABLE public.application_status_history ADD CHECK (new_status <> 'offer')");
  await assert.rejects(applications.update(pool, first.id, id, committed.rowVersion, { status: "offer" }), { code: "23514" });
  assert.deepEqual(await applications.get(pool, first.id, id), { ...committed, resumeName: null });
  assert.deepEqual(await history.list(pool, first.id, id), events);
}));

test("resume selections accept both parse states, permit unlinking, and preserve links on invalid replacement", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first, second } = await insertTestOwners(pool);
  const old = await insertResume(pool, first.id);
  const scanned = await insertResume(pool, first.id, "text_unavailable");
  const foreign = await insertResume(pool, second.id);
  const deleted = await insertResume(pool, first.id);
  await resumes.deleteAndUnlink(pool, first.id, deleted.id);

  const target = savedApplication(await applications.insert(pool, newApplication(first.id, { resumeId: old.id })));
  const sibling = savedApplication(await applications.insert(pool, newApplication(first.id, { resumeId: old.id })));
  const replaced = savedApplication(await applications.update(pool, first.id, target.id, "1", { resumeId: scanned.id }));
  assert.equal(replaced.resumeId, scanned.id);
  assert.equal(replaced.rowVersion, "2");
  assert.deepEqual(await applications.get(pool, first.id, sibling.id), { ...sibling, resumeName: old.name });

  for (const resumeId of [foreign.id, deleted.id]) {
    assert.deepEqual(await applications.insert(pool, newApplication(first.id, { resumeId })), { outcome: "RESUME_INELIGIBLE" });
    assert.deepEqual(await applications.update(pool, first.id, target.id, "2", { resumeId, status: "offer" }),
      { outcome: "RESUME_INELIGIBLE" });
    assert.deepEqual(await applications.get(pool, first.id, target.id), { ...replaced, resumeName: scanned.name });
  }
  const unlinked = savedApplication(await applications.update(pool, first.id, target.id, "2", { resumeId: null }));
  assert.equal(unlinked.resumeId, null);
  assert.equal(unlinked.rowVersion, "3");
  assert.equal((await applications.get(pool, first.id, sibling.id))?.resumeId, old.id);
}));
