import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../../src/app.js";
import { createPostgresApplicationService } from "../../src/modules/applications/postgres-module.js";
import { createApplicationRouter } from "../../src/modules/applications/routes.js";
import type { ApplicationResource } from "../../src/modules/applications/types.js";
import { readDashboard } from "../../src/modules/dashboard/postgres-repository.js";
import { createDashboardRouter, RECENT_APPLICATIONS } from "../../src/modules/dashboard/routes.js";
import { createAuthFixture, sessionCookie, uniqueEmail, verificationUrl, type AuthFixture } from "../helpers/auth-fixture.js";

const ORIGIN = "http://localhost:5173";
// Thursday Oct 29, 2026, 08:00 in Toronto. Clocks fall back on Nov 1, so the window is
// 2026-10-29T04:00Z (inclusive) to 2026-11-05T05:00Z (exclusive).
const NOW = new Date("2026-10-29T12:00:00Z");
const ZONE = "America/Toronto";

async function verifiedUser(fixture: AuthFixture): Promise<string> {
  await fixture.request("/api/auth/sign-up/email", { body: { name: "Applicant", email: uniqueEmail(), password: "a-strong-password-123" } });
  const verified = await fixture.request(verificationUrl(fixture.emails.at(-1)!, { callbackURL: null }));
  const cookie = sessionCookie(verified);
  assert.ok(cookie);
  return cookie;
}

/** The Dashboard and application routes behind real Sessions and origin checks, on real PostgreSQL. */
async function serve(t: test.TestContext) {
  const fixture = await createAuthFixture();
  const businessRouter = Router();
  businessRouter.use("/applications", createApplicationRouter({ service: createPostgresApplicationService(fixture.pool) }));
  businessRouter.use("/dashboard", createDashboardRouter({
    read: (userId, options) => readDashboard(fixture.pool, userId, options), clock: () => NOW,
  }));
  const app = createApp({ authentication: fixture.authentication, database: fixture.database,
    environment: { auth: fixture.config, trustProxyHops: 0 }, businessRouter });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await fixture.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const client = (cookie: string) => ({
    get: (path: string) => fetch(base + path, { headers: { cookie, origin: ORIGIN } }),
    create: async (body: unknown) => {
      const response = await fetch(`${base}/applications`, {
        method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 201, await response.clone().text());
      return await response.json() as ApplicationResource;
    },
  });
  return { fixture, base, client };
}

async function json<T>(response: Response, status: number): Promise<T> {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text) as T;
}

interface Dashboard {
  counts: { total: number; byStatus: Record<string, number> };
  offersEverReceived: number;
  interviewSessions: number;
  upcomingInterviews: { timeZone: string; start: string; end: string; items: Record<string, unknown>[] };
  recentApplications: Record<string, unknown>[];
}

test("the Dashboard reports the user's totals, next-7-days interviews and recent applications", { timeout: 30_000 }, async (t) => {
  const { fixture, base, client } = await serve(t);
  const owner = client(await verifiedUser(fixture));
  const other = client(await verifiedUser(fixture));

  // Protected like every /api/v1 route, and the time zone is required.
  assert.equal((await fetch(`${base}/dashboard?timeZone=${ZONE}`, { headers: { origin: ORIGIN } })).status, 401);
  for (const query of ["", "?timeZone=", "?timeZone=Not%2FAZone", `?timeZone=${ZONE}&timeZone=UTC`]) {
    const body = await json<{ error: { code: string; message: string } }>(await owner.get(`/dashboard${query}`), 400);
    assert.equal(body.error.code, "BAD_REQUEST", query);
    assert.match(body.error.message, /timeZone/, query);
  }

  // An empty account: zeros, every status present, empty lists.
  const empty = await json<Dashboard>(await owner.get(`/dashboard?timeZone=${ZONE}`), 200);
  assert.deepEqual(empty, {
    counts: { total: 0, byStatus: { saved: 0, applied: 0, oa: 0, interview: 0, offer: 0, rejected: 0 } },
    offersEverReceived: 0,
    interviewSessions: 0,
    upcomingInterviews: { timeZone: ZONE, start: "2026-10-29T04:00:00.000Z", end: "2026-11-05T05:00:00.000Z", items: [] },
    recentApplications: [],
  });

  // An offer that was later turned down still counts (FR-03), and its four interviews count as four.
  const declined = await owner.create({
    companyName: "Acme", jobTitle: "Backend Engineer", status: "rejected", offerReceived: true,
    interviews: [
      { type: "Too early", scheduledAt: "2026-10-28T23:59:59-04:00" },   // the day before: outside
      { type: "At start", scheduledAt: "2026-10-29T00:00:00-04:00" },    // local midnight today: inside
      { type: "Last day", scheduledAt: "2026-11-04T23:59:00-05:00" },    // the seventh day: inside
      { type: "At end", scheduledAt: "2026-11-05T00:00:00-05:00" },      // midnight after: outside
    ],
  });
  const middle = await owner.create({
    companyName: "Globex", jobTitle: "Full-stack Developer", status: "interview",
    interviews: [{ type: "Onsite", scheduledAt: "2026-11-02T10:00:00-05:00" }],
  });
  const older: ApplicationResource[] = [];
  for (const [companyName, status] of [["Initech", "saved"], ["Umbrella", "applied"], ["Hooli", "oa"], ["Stark", "offer"]] as const) {
    older.push(await owner.create({ companyName, jobTitle: "Engineer", status }));
  }
  // Another user's data never appears.
  await other.create({ companyName: "Elsewhere", jobTitle: "Engineer", status: "offer",
    interviews: [{ type: "Theirs", scheduledAt: "2026-10-30T10:00:00-04:00" }] });

  const dashboard = await json<Dashboard>(await owner.get(`/dashboard?timeZone=${ZONE}`), 200);
  assert.deepEqual(dashboard.counts, { total: 6, byStatus: { saved: 1, applied: 1, oa: 1, interview: 1, offer: 1, rejected: 1 } });
  assert.equal(dashboard.offersEverReceived, 2);
  assert.equal(dashboard.interviewSessions, 5);

  const interview = (application: ApplicationResource, type: string) => {
    const found = application.interviews.find((item) => item.type === type)!;
    return { id: found.id, applicationId: application.id, type, scheduledAt: new Date(found.scheduledAt).toISOString(),
      companyName: application.companyName, jobTitle: application.jobTitle };
  };
  assert.deepEqual(dashboard.upcomingInterviews.items, [
    interview(declined, "At start"), interview(middle, "Onsite"), interview(declined, "Last day"),
  ]);

  // Newest first, at most RECENT_APPLICATIONS, in the application-list summary shape.
  assert.equal(RECENT_APPLICATIONS, 5);
  const newestFirst = [...older].reverse().concat(middle);
  assert.deepEqual(dashboard.recentApplications.map((row) => row.id), newestFirst.map((row) => row.id));
  assert.deepEqual(Object.keys(dashboard.recentApplications[0]!).sort(),
    ["appliedDate", "companyName", "createdAt", "id", "jobTitle", "resumeId", "resumeName", "status"]);

  // The zone is echoed as sent, and a different zone moves the window.
  const lower = await json<Dashboard>(await owner.get("/dashboard?timeZone=america%2Ftoronto"), 200);
  assert.equal(lower.upcomingInterviews.timeZone, "america/toronto");
  const tokyo = await json<Dashboard>(await owner.get("/dashboard?timeZone=Asia%2FTokyo"), 200);
  assert.deepEqual([tokyo.upcomingInterviews.start, tokyo.upcomingInterviews.end], ["2026-10-28T15:00:00.000Z", "2026-11-04T15:00:00.000Z"]);
  assert.deepEqual(tokyo.upcomingInterviews.items.map((item) => item.type), ["Too early", "At start", "Onsite"]);
});
