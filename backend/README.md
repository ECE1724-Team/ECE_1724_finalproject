# Backend

Express + TypeScript backend. Use Node **26.x** (see `.nvmrc`).

## Setup and commands

From `backend/`:

```sh
nvm use
npm ci
cp .env.example .env   # only if you don't have a .env yet
```

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks `src/` and `tests/`, writes nothing |
| `npm test` | Compiles to `dist/tests/` and runs the unit tests. The route tests use HTTP loopback |
| `npm run build` | Compiles `src/` to `dist/` for running or deploying |
| `npm run migrate` | Applies pending PostgreSQL migrations |
| `npm run test:db` | Runs the PostgreSQL integration tests against disposable databases |
| `npm run test:r2` | Optional real R2 check, see below |

`dist/` is build output and is not committed. Deploy it together with `node_modules`
(the PDF parser loads font data from `pdfjs-dist` at runtime).

## PostgreSQL setup and tests

Create an empty development database, set `DATABASE_URL` in `backend/.env` or export it,
then run the migration command from `backend/` on Node 26.

```sh
createdb jobflow_dev
DATABASE_URL=postgresql://localhost:5432/jobflow_dev npm run migrate
```

The script loads `.env` and passes the validated PostgreSQL `DATABASE_URL` directly
to `node-pg-migrate`. The URL must name the target database. An exported
`DATABASE_URL` takes precedence over `.env`. The runner loads the CommonJS and TypeScript
files from `migrations/` and records them together in `public.pgmigrations`. Running
`npm run migrate` again applies only pending files. Use `npm run migrate -- --dry-run`
to list the migrations that would run. `npm run build` compiles `src/`.

Set `TEST_DATABASE_URL` in `.env` or export it when running `npm run test:db`. Use a local
PostgreSQL test database and a role with `CREATEDB`. For example, if your local role
already has that privilege, run the following from `backend/`.

```sh
createdb jobflow_test
TEST_DATABASE_URL=postgresql://localhost:5432/jobflow_test npm run test:db
```

The suite uses that connection to create a fresh, uniquely named database for each
fixture. It closes the pool and drops the database it created after the test. Migration
and reset steps run serially. `TEST_DATABASE_URL` is required and can be configured
independently of `DATABASE_URL`. Add PostgreSQL integration tests under
`tests/integration/` with the `.db.test.ts` suffix. The fixture helper provides two
fictional owners via `insertTestOwners(pool)` after migrations complete.

For application code, `createPool(env)` reads `DATABASE_URL` when called and defaults
to `process.env`. It applies the same check as `npm run migrate`, so the URL must name
its database. The caller passes the pool to `withTransaction(pool, callback)` and
awaits `pool.end()` at shutdown. Use the callback's client for every statement in the
transaction.

Verified on 2026-11-18 with Node **26.13.1**, PostgreSQL **18.6**, and
`node-pg-migrate` **9.0.0**. The suite applies these files in order, verifies a repeat
`up`, rolls back migration 006 in isolation, and then rolls back and reapplies all
seven files. It compares the migration history and schema catalog and verifies
transaction commit and rollback from a separate connection.

1. `20261111000100_auth_core.cjs`
2. `20261111000200_auth_credentials.cjs`
3. `20261116000100_create_resumes_applications.ts`
4. `20261116000200_create_status_history_interviews.ts`
5. `20261116000300_create_ai_workspaces_conversations.ts`
6. `20261116000400_create_ai_persistence.ts`
7. `20261118000700_create_storage_cleanup_jobs.ts` (migration 006)

The AI schema integration tests verify one workspace per application, independent
conversations, one active generation per conversation, and same-conversation run and
snapshot references. The application deletion tests cover the AI cascades and the
active-generation guard. Run both with `npm run test:db`.
[AI schema tests](tests/integration/ai-schema.db.test.ts) · [Application deletion tests](tests/integration/application-deletion.db.test.ts)

## Application and interview repositories

Import `createPostgresApplicationRepository`, `createPostgresApplicationStatusHistoryRepository`,
and `createPostgresInterviewRepository` from `./modules/applications/postgres-repository.js`
in backend entry points. Their signatures are in
[`repository.ts`](src/modules/applications/repository.ts). Pass the trusted user's ID.
The caller supplies UUIDs when creating applications and interviews.

- `applications.insert(db, input)` returns `OK` with the row or `RESUME_INELIGIBLE`.
- `applications.get(db, userId, id)` returns an owned row with its live `resumeName`, or
  `null` when the application is inaccessible. A missing live resume gives `resumeName: null`.
- `applications.update(db, userId, id, expectedRowVersion, changes)` returns `OK` with
  the row, `NOT_FOUND`, `RESUME_INELIGIBLE`, or `VERSION_CONFLICT`. For example, an
  update from version `"3"` that changes `status` returns version `"4"`. Reusing `"3"`
  returns `VERSION_CONFLICT`. Saving identical values returns the current row unchanged.
  Omit patch fields to retain them and pass `null` to clear nullable fields. In these
  internal calls, `appliedDate` is `YYYY-MM-DD` and `rowVersion` is a decimal string.
- `history.list(db, userId, applicationId)` returns actual transitions ordered by
  ascending `sequenceNo`, also a decimal string. Creation starts with an empty history.
- `interviews` supports insert, list, get, update, and delete. Single-round operations
  use both the application and interview IDs. List order is `startsAt`, then `id`.
  Use `applications.updateWithInterviews` to update an application and save its
  interviews atomically. It updates the application and its resume link first.
  Use the supplied transaction client for each interview write and throw if a write fails.
- `applications.delete(pool, userId, id)` returns `DELETED`, `NOT_FOUND`, or
  `GENERATION_ACTIVE`, which can map to HTTP 204, 404, or 409 respectively.

Resume-link changes take resume locks in ID order before locking the application.
Application deletion locks the application, then its workspace, then its conversations
in ID order. Generation acceptance must lock its conversation before inserting the
input and run. Conversation creation uses the workspace FK, and workspace creation
uses the application FK. `npm run test:db` exercises these locks with real PostgreSQL
and checks the complete application cascade against a saved conversation graph.

### Application list and Dashboard reads

`applications.list(db, userId, { search, status, sort, limit })` returns summary rows for
the owner. Each row includes the date-only `appliedDate` and the linked live `resumeName`
when available. Use `sort: "newest"` (the default) for descending creation time and ID,
or `sort: "company"` for lowercased company name and ascending ID. Search matches a
literal case-insensitive substring of the company or position and combines with status.
All matches are returned by default. The AI position selector can project `id`,
`companyName`, `positionTitle`, and `status` from the same list.

`applications.counts(db, userId)` returns all six `statusCounts`, `totalApplications`
for the **All** filter, and `offersEverReceived`. `readDashboard(pool, userId,
{ windowStart, windowEnd, recentLimit })` from `./modules/dashboard/postgres-repository.js`
adds `totalInterviewSessions`, `upcomingInterviews`, and `recentApplications` in one
database snapshot. The caller supplies local midnight today and local midnight seven
calendar dates later as `Date` instants. `windowStart` is included and `windowEnd` is
excluded. `recentLimit` only caps the recent rows.

The acceptance fixture gives both of owner A's applications the same `createdAt`.
[Dashboard acceptance fixture](tests/integration/dashboard.db.test.ts)

| ID | Company | Position | Status | Applied date | Resume |
|---|---|---|---|---|---|
| `a0000000-0000-4000-8000-000000000001` | North Labs | Backend Engineer | `saved` | `null` | `null` |
| `a0000000-0000-4000-8000-000000000002` | NORTH LABS | Platform 100% _Tools! | `rejected` after `offer` | `2026-10-28` | Example resume |

Newest-first gives ID `…002` followed by `…001`. Company order reverses those rows.
Searching for `%` finds `…002`. Adding the `saved` filter gives an empty list. Counts are 2
applications, 3 interview sessions and 1 historical offer. The Toronto window from
October 29 to November 5, 2026 includes interview IDs
`b0000000-0000-4000-8000-000000000001` (at midnight) and
`b0000000-0000-4000-8000-000000000002` (that morning). The third starts at the end
boundary. Deleting application `…002` changes the totals to 1 application, 0 interviews
and 0 offers, with only `…001` in recent applications.

## Resume storage and PDF parsing (R2 / PDF)

Owner: Jianye Zhou (progress and plan: [JIANYE_DEV_PLAN.md](../docs/JIANYE_DEV_PLAN.md)).
File rules: [PRD §5.2](../docs/PRD.md). Upload and delete transactions:
[Database Design §7.2–7.3](../docs/Database_Design.md).

**Status:** `npm run test:db` exercises upload, owner isolation, download, unlinking,
and worker cleanup through the mounted routes with real PostgreSQL and PDF parsing.
The HTTP test supplies test middleware and fake object storage. Apply migration 006
with `npm run migrate` before starting the module.
[Resume HTTP integration test](tests/integration/resume-http.db.test.ts)

### R2 setup

1. Create a **private** R2 bucket (keep `r2.dev` and public custom domains off).
2. Create an R2 API token with object read/write on that bucket only.
3. Fill in `.env`: `R2_ENDPOINT` (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`),
   `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

Browsers never talk to R2 directly; PDFs are served through the authenticated backend.

To test against real R2, point `.env` at a **development-only** bucket, set
`R2_INTEGRATION_TEST=1` and run `npm run test:r2`. It writes, reads and deletes one
random test object. Without that flag it is reported as skipped.

### Files

| File | Purpose |
|---|---|
| `src/modules/resumes/routes.ts` | `createResumeRouter()`: the five `/api/v1/resumes` routes, upload parsing (multer, 2 MiB), error → HTTP mapping |
| `src/modules/resumes/service.ts` | `createResumeService()`: upload, list, get, download, remove. Takes a verified `userId`; no Express |
| `src/modules/resumes/cleanup-worker.ts` | `startCleanupWorker()`: deletes queued R2 objects with retries |
| `src/modules/resumes/repository.ts` | `ResumeRepository` and `StorageCleanupRepository` interfaces |
| `src/modules/resumes/postgres-repository.ts` | PostgreSQL implementations of both repositories |
| `src/modules/resumes/postgres-module.ts` | `createPostgresResumeModule()` wires the service and worker to the same repositories |
| `src/modules/resumes/postgres-routes.ts` | `mountPostgresResumeRoutes()` mounts the PostgreSQL-backed routes and returns the worker starter |
| `src/modules/resumes/pdf-policy.ts` | `validateResumePdf()`: the PRD file rules |
| `src/integrations/object-storage/r2.ts` | `createR2Storage()`, `createObjectKey()` |
| `src/integrations/pdf/extractor.ts` | `createPdfExtractor()`: parses PDFs in a worker thread with a timeout and a concurrency limit |
| `src/config/env.ts` | `readR2Config()`: reads and checks the R2 variables |

### Mounting from server startup

```ts
import { mountPostgresResumeRoutes } from "./modules/resumes/postgres-routes.js";

const pool = createPool();
const storage = createR2Storage(readR2Config());
const pdf = createPdfExtractor();                 // ONE per process: it holds the parse limit
const startResumeWorker = mountPostgresResumeRoutes(app, {
  pool, storage, pdf, authenticate: requireVerifiedUser(authentication),
});
const worker = startResumeWorker();
// On shutdown: stop accepting requests, await worker.stop(), storage.close(), await pool.end().
```

`authenticate` must reject unauthenticated or unverified users and set
`res.locals.auth.userId`. The router runs it before reading any upload body.

### File rules

- **Rejected**: over 2 MiB, not a PDF, damaged, password-protected, more than 2 pages. Nothing is stored.
- **Accepted, `textStatus: "available"`**: at least 100 non-whitespace characters and text
  on every page. The extracted text is saved for the AI.
- **Accepted, `textStatus: "unavailable"`**: e.g. a scanned resume. Stored and linkable,
  but no text is saved; the frontend shows the AI warning from `textStatus`. Stored as
  `parse_status = 'text_unavailable'`.

### HTTP errors

Body: `{ "error": { "code", "message" } }` (see `endpoints.json`).

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `name` or `file`, or more than one file |
| 404 | `NOT_FOUND` | Missing, deleted or someone else's resume, or an id that isn't a UUID |
| 413 | `PDF_TOO_LARGE` | File over 2 MiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Upload not sent as `multipart/form-data` |
| 422 | `VALIDATION_ERROR` | Name not 1–200 characters after trimming |
| 422 | `PDF_INVALID`, `PDF_TOO_MANY_PAGES`, `PDF_PASSWORD_PROTECTED` | File problems |
| 503 | `PDF_BUSY` (+ `Retry-After: 5`), `PDF_PROCESSING_FAILED`, `SERVICE_UNAVAILABLE` | Server-side, worth a retry |
| 500 | `INTERNAL_ERROR` | Bugs; details only in the server log |

Limits are constants in code: R2 timeout 30 s (`r2.ts`); PDF parse timeout 15 s,
2 parses at a time, 256 MB worker heap (`extractor.ts`); cleanup every 30 s, retries after
1 min, 5 min, 30 min, 2 h, then every 6 h (`cleanup-worker.ts`).

### Rules for code that touches resumes

- Never take a user ID or a storage key from the request.
- Linking a resume to an application goes through the application update, which is a
  **full replacement**: sending only `resumeId` would clear the other fields. The resume
  must belong to the same user, not be deleted, and be `succeeded` or `text_unavailable`,
  checked in the same transaction (resume row locked before the application).
- R2 objects of deleted resumes are removed only by the cleanup worker after the delete
  transaction commits. Never use a bucket lifecycle rule to expire resume objects.

### Known gaps

- The live session check requires the team's verified-user middleware and server startup.
- Assumes one backend instance: the cleanup worker puts every `processing` job back to
  `pending` before each pass (Database Design §5.11). Running several instances needs the
  lease design in Database Design §5.7.
- The live R2 check has not been run.
- Text order follows the PDF's internal order. Unusual two-column layouts may come out
  interleaved, so check a few real Word/LaTeX exports by hand.
- Tests for encrypted PDFs and for 99 + 1 characters split across pages were dropped
  because their fixtures failed; that behavior is untested.
