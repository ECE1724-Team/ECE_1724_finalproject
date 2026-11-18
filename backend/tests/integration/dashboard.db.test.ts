import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { withTransaction } from "../../src/db/transaction.js";
import { createPostgresApplicationRepository, createPostgresInterviewRepository } from "../../src/modules/applications/postgres-repository.js";
import { readDashboard } from "../../src/modules/dashboard/postgres-repository.js";
import { insertResume, newApplication, savedApplication } from "../helpers/applications.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";
import { waitForBlockedQuery, withLockHolder } from "../helpers/lock-race.js";

const applications = createPostgresApplicationRepository();
const interviews = createPostgresInterviewRepository();

const ids = {
  saved: "a0000000-0000-4000-8000-000000000001",
  rejected: "a0000000-0000-4000-8000-000000000002",
  foreign: "a0000000-0000-4000-8000-000000000003",
  midnight: "b0000000-0000-4000-8000-000000000001",
  morning: "b0000000-0000-4000-8000-000000000002",
  windowEnd: "b0000000-0000-4000-8000-000000000003",
  foreignInterview: "b0000000-0000-4000-8000-000000000004",
};

// Toronto local midnights across the end of daylight saving time.
const window = {
  windowStart: new Date("2026-10-29T00:00:00-04:00"),
  windowEnd: new Date("2026-11-05T00:00:00-05:00"),
};
const morning = new Date("2026-10-29T09:00:00-04:00");
const initialCounts = {
  statusCounts: { saved: 1, applied: 0, oa: 0, interview: 0, offer: 0, rejected: 1 },
  totalApplications: 2,
  offersEverReceived: 1,
};

async function seedDashboard(pool: Pool) {
  const { first, second } = await insertTestOwners(pool);
  const resume = await insertResume(pool, first.id);
  const { saved, offered } = await withTransaction(pool, async (client) => {
    const saved = savedApplication(await applications.insert(client, newApplication(first.id, {
      id: ids.saved, companyName: "North Labs", positionTitle: "Backend Engineer",
    })));
    const offered = savedApplication(await applications.insert(client, newApplication(first.id, {
      id: ids.rejected, companyName: "NORTH LABS", positionTitle: "Platform 100% _Tools!", status: "offer",
      appliedDate: "2026-10-28", resumeId: resume.id,
    })));
    return { saved, offered };
  });
  const rejected = savedApplication(await applications.update(pool, first.id, offered.id, offered.rowVersion, { status: "rejected" }));
  const foreign = savedApplication(await applications.insert(pool, newApplication(second.id, {
    id: ids.foreign, companyName: "North Labs", positionTitle: "Platform 100x ToolsX", status: "offer",
  })));

  const a = { userId: first.id, applicationId: rejected.id };
  // Insert out of chronological order to exercise the query order.
  await interviews.insert(pool, { ...a, id: ids.windowEnd, interviewName: "At end", startsAt: window.windowEnd });
  await interviews.insert(pool, { ...a, id: ids.morning, interviewName: "Morning round", startsAt: morning });
  await interviews.insert(pool, { ...a, id: ids.midnight, interviewName: "At start", startsAt: window.windowStart });
  await interviews.insert(pool, {
    id: ids.foreignInterview, userId: second.id, applicationId: foreign.id, interviewName: "Other owner's round", startsAt: morning,
  });

  return { userId: first.id, otherUserId: second.id, saved, rejected, resume };
}

test("application list and detail are owner-scoped, with literal search and stable sorts", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { userId, otherUserId, saved, rejected, resume } = await seedDashboard(pool);
  assert.deepEqual(saved.createdAt, rejected.createdAt);
  const rows = await applications.list(pool, userId);
  const [newest, older] = rows;
  assert.deepEqual(rows, [
    {
      id: ids.rejected, companyName: "NORTH LABS", positionTitle: "Platform 100% _Tools!", status: "rejected",
      appliedDate: "2026-10-28", resumeId: resume.id, resumeName: resume.name, rowVersion: "2", createdAt: rejected.createdAt,
    },
    {
      id: ids.saved, companyName: "North Labs", positionTitle: "Backend Engineer", status: "saved",
      appliedDate: null, resumeId: null, resumeName: null, rowVersion: "1", createdAt: saved.createdAt,
    },
  ]);
  assert.deepEqual(await applications.list(pool, userId, { sort: "company" }), [older, newest]);
  assert.deepEqual(await applications.list(pool, userId, { search: "  OrTh La  ", status: "rejected" }), [newest]);
  assert.deepEqual(await applications.list(pool, userId, { search: "bAcKeNd" }), [older]);
  for (const search of ["%", "_", "!", "100% _tools!"]) {
    assert.deepEqual(await applications.list(pool, userId, { search }), [newest]);
  }
  assert.deepEqual(await applications.list(pool, userId, { search: "%", status: "saved" }), []);
  assert.deepEqual(await applications.list(pool, userId, { limit: 1 }), [newest]);
  assert.deepEqual(await applications.counts(pool, userId), initialCounts);
  assert.deepEqual((await applications.list(pool, otherUserId, { search: "north" })).map(({ id }) => id), [ids.foreign]);
  assert.equal(await applications.get(pool, otherUserId, rejected.id), null);
  assert.deepEqual(await applications.get(pool, userId, rejected.id), { ...rejected, resumeName: resume.name });
  assert.deepEqual(await applications.get(pool, userId, saved.id), { ...saved, resumeName: null });

  // A legacy reference to a tombstoned row must not expose the resume name.
  await pool.query("UPDATE public.resumes SET deleted_at = CURRENT_TIMESTAMP, extracted_text = NULL WHERE id = $1", [resume.id]);
  assert.deepEqual(await applications.list(pool, userId, { status: "rejected" }), [{ ...newest, resumeName: null }]);
  assert.equal((await applications.get(pool, userId, rejected.id))?.resumeName, null);

  await pool.query("UPDATE public.applications SET created_at = created_at + interval '1 day', company_name = 'Zenith' WHERE id = $1", [saved.id]);
  assert.deepEqual((await applications.list(pool, userId)).map(({ id }) => id), [ids.saved, ids.rejected]);
  assert.deepEqual((await applications.list(pool, userId, { sort: "company" })).map(({ id }) => id), [ids.rejected, ids.saved]);
}));

test("Dashboard totals, seven-calendar-day interviews and recent rows follow the current owned set", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { userId, otherUserId } = await seedDashboard(pool);
  assert.equal((window.windowEnd.getTime() - window.windowStart.getTime()) / 3_600_000, 169);

  const { upcomingInterviews, recentApplications, ...totals } = await readDashboard(pool, userId, window);
  assert.deepEqual(totals, { ...initialCounts, totalInterviewSessions: 3 });
  assert.deepEqual(recentApplications.map(({ id }) => id), [ids.rejected, ids.saved]);
  const target = { applicationId: ids.rejected, companyName: "NORTH LABS", positionTitle: "Platform 100% _Tools!" };
  assert.deepEqual(upcomingInterviews, [
    { ...target, id: ids.midnight, interviewName: "At start", startsAt: window.windowStart },
    { ...target, id: ids.morning, interviewName: "Morning round", startsAt: morning },
  ]);
  const foreign = await readDashboard(pool, otherUserId, window);
  assert.equal(foreign.totalApplications, 1);
  assert.equal(foreign.totalInterviewSessions, 1);
  assert.deepEqual(foreign.upcomingInterviews.map(({ id }) => id), [ids.foreignInterview]);

  await interviews.update(pool, userId, ids.rejected, ids.morning, { startsAt: window.windowStart });
  const limited = await readDashboard(pool, userId, { ...window, recentLimit: 1 });
  assert.deepEqual(limited.upcomingInterviews.map(({ id }) => id), [ids.midnight, ids.morning]);
  assert.deepEqual(limited.recentApplications.map(({ id }) => id), [ids.rejected]);
  assert.deepEqual(limited.statusCounts, initialCounts.statusCounts);
  assert.equal(limited.totalApplications, 2);

  const beforeWindow = new Date(window.windowStart.getTime() - 1);
  await interviews.update(pool, userId, ids.rejected, ids.morning, { startsAt: beforeWindow });
  const fromMidnight = await readDashboard(pool, userId, window);
  assert.deepEqual(fromMidnight.upcomingInterviews.map(({ id }) => id), [ids.midnight]);
  assert.equal(fromMidnight.totalInterviewSessions, 3);

  assert.equal(await applications.delete(pool, userId, ids.rejected), "DELETED");
  const current = await readDashboard(pool, userId, window);
  assert.equal(current.totalApplications, 1);
  assert.equal(current.totalInterviewSessions, 0);
  assert.equal(current.offersEverReceived, 0);
  assert.deepEqual(current.statusCounts, { ...initialCounts.statusCounts, rejected: 0 });
  assert.deepEqual(current.upcomingInterviews, []);
  assert.deepEqual(current.recentApplications.map(({ id }) => id), [ids.saved]);
}));

test("a Dashboard read keeps one snapshot across a concurrent application deletion", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const { userId } = await seedDashboard(pool);
  const { pendingRead } = await withLockHolder(pool, async (holder, pid, start) => {
    // Pause the reader after application counts, before it can read interviews.
    await holder.query("LOCK TABLE public.interviews IN ACCESS EXCLUSIVE MODE");
    const pendingRead = start(readDashboard(pool, userId, window));
    await waitForBlockedQuery(pool, pid, "FROM public.interviews");
    await holder.query("DELETE FROM public.applications WHERE user_id = $1 AND id = $2", [userId, ids.rejected]);
    return { pendingRead };
  });

  const before = await pendingRead;
  assert.deepEqual(before.statusCounts, initialCounts.statusCounts);
  assert.equal(before.totalApplications, 2);
  assert.equal(before.totalInterviewSessions, 3);
  assert.equal(before.offersEverReceived, 1);
  assert.deepEqual(before.upcomingInterviews.map(({ id }) => id), [ids.midnight, ids.morning]);
  assert.deepEqual(before.recentApplications.map(({ id }) => id), [ids.rejected, ids.saved]);
  const after = await readDashboard(pool, userId, window);
  assert.equal(after.totalApplications, 1);
  assert.equal(after.totalInterviewSessions, 0);
  assert.equal(after.offersEverReceived, 0);
  assert.deepEqual(after.recentApplications.map(({ id }) => id), [ids.saved]);
}));
