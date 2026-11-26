// Fills a development database with one demo account and the fictional data in demo-data.mjs.
// Run from backend/: `npm run seed` (builds first, reads .env).
//
// - Uses the backend's own services, so data passes the same checks as the API: applications go
//   through the application service (status history included), and resume PDFs through the same
//   validation, text extraction and R2 upload as the upload page.
// - Re-running starts over: the demo account's applications (with their AI conversations) and
//   resumes are deleted first. The server's cleanup worker removes the old PDFs from R2.
//
// Settings (environment or .env): DATABASE_URL, R2_*, SEED_EMAIL (default
// avery.whitlock@example.com), SEED_PASSWORD (needed only to create the account; at least 8
// characters) and SEED_RESUME_DIR (default ../resume, the folder with the PDFs).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { readR2Config } from "../dist/config/env.js";
import { createPool } from "../dist/db/pool.js";
import { createR2Storage } from "../dist/integrations/object-storage/r2.js";
import { createPdfExtractor } from "../dist/integrations/pdf/extractor.js";
import { ensureWorkspace } from "../dist/modules/ai/workspaces/postgres-repository.js";
import { createPostgresApplicationService } from "../dist/modules/applications/postgres-module.js";
import { createPostgresResumeModule } from "../dist/modules/resumes/postgres-module.js";
import { applications as demoApplications, resumes as demoResumes } from "./demo-data.mjs";

if (process.env.NODE_ENV === "production") throw new Error("The demo seed only runs on development databases.");

const email = (process.env.SEED_EMAIL ?? "avery.whitlock@example.com").trim().toLowerCase();
const resumeDir = path.resolve(process.env.SEED_RESUME_DIR ?? "../resume");

const pool = createPool();
const storage = createR2Storage(readR2Config());
const applications = createPostgresApplicationService(pool);
const resumes = createPostgresResumeModule({ pool, storage, pdf: createPdfExtractor() }).service;

/** Local time `days` from today at hour:minute. */
function daysFromNow(days, hour = 9, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function findOrCreateUser() {
  const { rows: [existing] } = await pool.query("SELECT id FROM public.auth_user WHERE email = $1", [email]);
  if (existing) return existing.id;

  const password = process.env.SEED_PASSWORD ?? "";
  if (password.length < 8) throw new Error("Set SEED_PASSWORD (at least 8 characters) to create the demo account.");
  // Same hash and account shape as Better Auth's email sign-up; the email counts as verified.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [user] } = await client.query(
      `INSERT INTO public.auth_user (name, email, "emailVerified") VALUES ('Avery Whitlock', $1, true) RETURNING id`, [email]);
    await client.query(
      `INSERT INTO public.auth_account ("accountId", "providerId", "userId", password) VALUES ($1::text, 'credential', $1::uuid, $2)`,
      [user.id, await hashPassword(password)]);
    await client.query("COMMIT");
    console.log(`Created verified account ${email}`);
    return user.id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function clearDemoData(userId) {
  const { data } = await applications.list(userId, { sort: "newest" });
  for (const application of data) await applications.remove(userId, application.id);
  const live = await resumes.list(userId);
  for (const resume of live) await resumes.remove(userId, resume.id);
  if (data.length || live.length) console.log(`Removed ${data.length} applications and ${live.length} resumes from the previous run`);
}

async function uploadResumes(userId) {
  const files = (await readdir(resumeDir)).filter((file) => file.toLowerCase().endsWith(".pdf"));
  const ids = {};
  for (const { key, name } of demoResumes) {
    const file = files.find((candidate) => candidate.includes(key));
    if (!file) throw new Error(`No PDF with "${key}" in its name in ${resumeDir}`);
    const resume = await resumes.upload({ userId, name, fileName: file, bytes: new Uint8Array(await readFile(path.join(resumeDir, file))) });
    ids[key] = resume.id;
    console.log(`Uploaded ${file}: ${resume.parseStatus === "succeeded" ? "text extracted" : "no readable text"}`);
  }
  return ids;
}

/** Creates the application at its first status, then moves it along `path` so the history is real. */
async function addApplication(userId, spec, resumeIds, position) {
  const [first, ...rest] = spec.path;
  const input = {
    companyName: spec.companyName,
    jobTitle: spec.jobTitle,
    appliedDate: first === "saved" ? null : daysFromNow(-spec.daysAgo).toLocaleDateString("en-CA"),
    jobDescription: spec.jobDescription ?? null,
    jobUrl: spec.jobUrl ?? null,
    resumeId: spec.resume ? resumeIds[spec.resume] : null,
    companyWebsiteUrl: spec.companyWebsiteUrl ?? null,
    companyNotes: spec.companyNotes ?? null,
    notes: spec.notes ?? null,
    offerReceived: false,
    interviews: [],
  };
  let application = await applications.create(userId, { ...input, status: first });
  for (const status of rest) {
    application = await applications.replace(userId, application.id,
      { ...input, status, offerReceived: application.offerReceived }, application.rowVersion);
  }
  if (spec.interviews) {
    const interviews = spec.interviews.map(({ type, days, hour, minute }) => ({ type, scheduledAt: daysFromNow(days, hour, minute) }));
    application = await applications.replace(userId, application.id,
      { ...input, status: application.status, offerReceived: application.offerReceived, interviews }, application.rowVersion);
  }

  // Lists show the newest record first, so the record's added time follows the order in
  // demo-data.mjs. Status changes are spread from the applied date (`daysAgo`) to today.
  const addedAt = new Date(Date.now() - position * 60_000);
  await pool.query("UPDATE public.applications SET created_at = $2, updated_at = $2 WHERE id = $1", [application.id, addedAt]);
  await pool.query(`
    UPDATE public.application_status_history
    SET changed_at = LEAST($2::timestamptz + sequence_no * ($3::float * interval '1 day'), now())
    WHERE application_id = $1
  `, [application.id, daysFromNow(-spec.daysAgo, 10), spec.daysAgo / spec.path.length]);

  if (spec.ai) await ensureWorkspace(pool, userId, application.id);
  return application;
}

try {
  const userId = await findOrCreateUser();
  await clearDemoData(userId);
  const resumeIds = await uploadResumes(userId);
  for (const [position, spec] of demoApplications.entries()) await addApplication(userId, spec, resumeIds, position);
  console.log(`Added ${demoApplications.length} applications; ${demoApplications.filter((spec) => spec.ai).length} have AI workspaces.`);
} finally {
  storage.close();
  await pool.end();
}
