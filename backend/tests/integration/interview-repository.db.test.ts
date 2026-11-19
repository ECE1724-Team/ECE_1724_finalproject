import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { withTransaction } from "../../src/db/transaction.js";
import { createPostgresApplicationRepository, createPostgresInterviewRepository } from "../../src/modules/applications/postgres-repository.js";
import type { NewInterview } from "../../src/modules/applications/repository.js";
import { insertResume, newApplication, savedApplication } from "../helpers/applications.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

const applications = createPostgresApplicationRepository();
const interviews = createPostgresInterviewRepository();

test("individual interviews keep IDs, order by instant and ID, and check the owner and parent", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first, second } = await insertTestOwners(pool);
  const userId = first.id;
  const { id: applicationId } = savedApplication(await applications.insert(pool, newApplication(userId)));
  const { id: otherApplication } = savedApplication(await applications.insert(pool, newApplication(userId)));
  const startsAt = new Date("2025-01-01T09:00:00-05:00");
  const base = { userId, applicationId, startsAt };
  const firstId = "10000000-0000-4000-8000-000000000001";
  const middleId = "10000000-0000-4000-8000-000000000002";
  const lastId = "10000000-0000-4000-8000-000000000003";
  const last = await interviews.insert(pool, { ...base, id: lastId, interviewName: "Final" });
  const middle = await interviews.insert(pool, { ...base, id: middleId, interviewName: "  Technical round  " });
  const earliest = await interviews.insert(pool, { ...base, id: firstId, interviewName: "🙂".repeat(100) });
  assert.ok(last && middle && earliest);
  assert.equal(middle.interviewName, "Technical round");
  assert.equal(middle.startsAt.toISOString(), "2025-01-01T14:00:00.000Z");
  assert.deepEqual(await interviews.list(pool, userId, applicationId), [earliest, middle, last]);
  assert.deepEqual(await interviews.get(pool, userId, applicationId, middleId), middle);

  assert.deepEqual(await interviews.list(pool, second.id, applicationId), []);
  assert.equal(await interviews.insert(pool, { ...base, id: randomUUID(), userId: second.id, interviewName: "Foreign" }), null);
  for (const [owner, parent] of [[second.id, applicationId], [userId, otherApplication]]) {
    assert.equal(await interviews.get(pool, owner, parent, middleId), null);
    assert.equal(await interviews.update(pool, owner, parent, middleId, { interviewName: "Wrong" }), null);
    assert.equal(await interviews.delete(pool, owner, parent, middleId), false);
  }

  for (const name of ["  \t ", "🙂".repeat(101)]) {
    await assert.rejects(interviews.insert(pool, { ...base, id: randomUUID(), interviewName: name }), { code: "23514" });
    await assert.rejects(interviews.update(pool, userId, applicationId, middleId, { interviewName: name }), { code: "23514" });
  }
  const missingTime = { id: randomUUID(), userId, applicationId, interviewName: "Missing time" } as NewInterview;
  await assert.rejects(interviews.insert(pool, missingTime), { code: "23502" });

  const revisedTime = new Date("2024-12-31T17:00:00Z");
  const edited = await interviews.update(pool, userId, applicationId, middleId, { interviewName: "  Coding  ", startsAt: revisedTime });
  assert.ok(edited);
  assert.equal(edited.id, middleId);
  assert.equal(edited.applicationId, applicationId);
  assert.equal(edited.interviewName, "Coding");
  assert.deepEqual(edited.startsAt, revisedTime);
  assert.deepEqual(edited.createdAt, middle.createdAt);
  assert.deepEqual(await interviews.list(pool, userId, applicationId), [edited, earliest, last]);
  assert.equal(await interviews.delete(pool, userId, applicationId, lastId), true);
  assert.equal(await interviews.delete(pool, userId, applicationId, lastId), false);
  assert.deepEqual(await interviews.list(pool, userId, applicationId), [edited, earliest]);
}));

test("an application save and an interview insert can share a caller transaction", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first } = await insertTestOwners(pool);
  const input = newApplication(first.id);
  const abort = new Error("caller chose to roll back the save");
  await assert.rejects(withTransaction(pool, async (client) => {
    const saved = savedApplication(await applications.insert(client, input));
    assert.ok(await interviews.insert(client, {
      id: randomUUID(), userId: first.id, applicationId: saved.id, interviewName: "Screen", startsAt: new Date(),
    }));
    throw abort;
  }), (error) => error === abort);
  assert.equal(await applications.get(pool, first.id, input.id), null);
  assert.deepEqual((await pool.query("SELECT id FROM public.interviews")).rows, []);
}));

test("a failed interview write rolls back the application update and resume link", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { first: { id: userId } } = await insertTestOwners(pool);
  const resume = await insertResume(pool, userId);
  const { id, rowVersion } = savedApplication(await applications.insert(pool, newApplication(userId)));
  const original = await applications.get(pool, userId, id);
  const interview = { id: randomUUID(), userId, applicationId: id, interviewName: "Screen", startsAt: new Date() };

  await assert.rejects(applications.updateWithInterviews(pool, userId, id, rowVersion,
    { resumeId: resume.id, status: "interview" }, async (client) => {
      assert.ok(await interviews.insert(client, interview));
      await interviews.insert(client, { ...interview, id: randomUUID(), interviewName: " " });
    }), { code: "23514" });

  assert.deepEqual(await applications.get(pool, userId, id), original);
  assert.deepEqual(await interviews.list(pool, userId, id), []);
  assert.deepEqual((await pool.query("SELECT id FROM public.application_status_history WHERE application_id = $1", [id])).rows, []);
}));
