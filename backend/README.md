# Backend

Express + TypeScript backend (CommonJS output). Use Node **26.x** (see `.nvmrc`) and
PostgreSQL with `gen_random_uuid()` support.

## Setup and commands

From `backend/`:

```sh
nvm use
npm ci
cp .env.example .env   # only if you don't have a .env yet
npm run migrate        # applies every migration in migrations/ to DATABASE_URL
npm run dev            # builds, then starts the API on PORT (default 3000)
```

Use a dedicated development database, generate a private `BETTER_AUTH_SECRET`, put the
frontend's exact origin in `AUTH_TRUSTED_ORIGINS`, and configure SMTP (a local SMTP catcher
is fine in development). Keep `.env` out of git. Startup checks that the auth tables exist; it
never creates or migrates the schema itself.

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks `src/` and `tests/`, writes nothing |
| `npm test` | Compiles to `dist/tests/` and runs the offline unit and contract tests (no credentials, database or network needed; route tests use HTTP loopback) |
| `npm run test:db` | Runs every test, including the PostgreSQL ones, on disposable databases; see [Checks](#checks) |
| `npm run build` | Compiles `src/` to `dist/` for running or deploying |
| `npm start` | Runs the compiled server (`dist/server.js`), reading `.env` if present |
| `npm run dev` | `build` + `start` (no watch mode: the PDF worker only exists as compiled output) |
| `npm run migrate` / `npm run migrate:down` | Applies all pending migrations (`npm run migrate -- --dry-run` lists them) / rolls back the latest one. `migrate:down` can destroy data; use it only on a development or test database |
| `npm run test:r2` | Optional real R2 check, see below |

`dist/` is build output and is not committed. Deploy it together with `node_modules`
(the PDF parser loads font data from `pdfjs-dist` at runtime).

## Authentication and authorization

Owner: Zishi Yang. Design and behavior: [Auth_Implementation.md](../docs/Auth_Implementation.md);
schema: [Database Design Appendices D–F](../docs/Database_Design.md#shared-identity).

- Better Auth 1.7.20 is mounted at `/api/auth` (only the routes in `endpoints.json` are exposed).
  Browsers send `credentials: "include"`; never store Session tokens in local storage.
- Every `/api/v1` request first passes a CSRF origin check (unsafe methods must come from
  `AUTH_TRUSTED_ORIGINS`) and `requireVerifiedUser`, which reads the Session from PostgreSQL
  and sets `res.locals.auth = { userId, sessionId, emailVerified: true }`. Anonymous → 401
  `UNAUTHORIZED`, unverified → 403 `EMAIL_NOT_VERIFIED`, database down → 503 `SERVICE_UNAVAILABLE`.
- Business routers go in `createApp({ businessRouter })` (`src/app.ts`). Inside it, use
  `requireAuthContext` where a router asks for an `authenticate` handler (it checks the context
  without a second Session read), and `requireOwnedResource(database, kind, param)` for
  application/resume/workspace/conversation IDs. In a handler, read the identity with
  `getAuthContext(res)` and scope every SQL statement by its `userId`.
- Auth endpoints (`/api/auth/*`) keep Better Auth's `{ code, message }` body. PostgreSQL down →
  503 `SERVICE_UNAVAILABLE`; other unexpected failures → 500 `INTERNAL_SERVER_ERROR`.
- `server.ts` creates two pools with `createPool()`: the main one and `rateLimitPool` for Better
  Auth's IP/path counters, which must survive a rolled-back request. Auth emails are sent after
  commit by a queue of at most two concurrent SMTP sends, each bounded by 10 s / 10 s / 30 s
  (connect / greeting / socket) timeouts. File map: [Auth_Implementation.md](../docs/Auth_Implementation.md#code-map).
- Confirmed settings (2026-11-11): 7-day Sessions; verification/reset links last 900 s and only the
  latest link per user and purpose works; 60 s cooldown and at most 5 emails per 15 min per
  recipient and purpose; a replacement link becomes active only after SMTP accepts it.
- Production requires HTTPS origins. Set `TRUST_PROXY_HOPS` only for a known reverse-proxy chain.

<a id="checks"></a>

### Checks

`npm run test:db` loads `.env` if present and runs every compiled test one at a time: unit,
contract, the auth integration tests and the `*.db.test.ts` repository and migration tests.
The live R2 check (`r2.test.js`) is excluded; run it with `npm run test:r2`.

- **`TEST_DATABASE_URL` set** (exported or in `.env`): the tests use that server. Point it at an
  isolated test server where the role may `CREATE DATABASE` (for example
  `createdb jobflow_test` with a role that has `CREATEDB`), never at the application database.
- **`TEST_DATABASE_URL` unset or empty**: the script creates a disposable PostgreSQL cluster from
  the local server binaries (`pg_config --bindir`) on a private Unix socket and removes it
  afterwards. It must run as a non-root user allowed to create local sockets.

Either way, every fixture creates and drops its own randomly named database. SMTP tests use a
localhost-only server and send no real mail. Add PostgreSQL tests under `tests/integration/`
with the `.db.test.ts` suffix; `withTestDatabase()` and `insertTestOwners(pool)` in
`tests/helpers/database.ts` provide a migrated database and two fictional owners.

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

See [Checks](#checks) for `npm run test:db`.

For application code, `createPool(env)` reads `DATABASE_URL` when called and defaults
to `process.env`. It applies the same check as `npm run migrate`, so the URL must name
its database. The caller passes the pool to `withTransaction(pool, callback)` and
awaits `pool.end()` at shutdown. Use the callback's client for every statement in the
transaction. If the callback catches a failed statement, `withTransaction` throws: PostgreSQL has
rolled the whole transaction back, so it is not reported as a success.

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

The routes belong in `businessRouter` (see [Mounting](#mounting-from-server-startup));
`server.ts` does not mount them yet.

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
| `src/modules/resumes/postgres-routes.ts` | `mountPostgresResumeRoutes()` mounts on a bare Express app; with `createApp` use `createPostgresResumeModule()` instead (see Mounting) |
| `src/modules/resumes/pdf-policy.ts` | `validateResumePdf()`: the PRD file rules |
| `src/integrations/object-storage/r2.ts` | `createR2Storage()`, `createObjectKey()` |
| `src/integrations/pdf/extractor.ts` | `createPdfExtractor()`: parses PDFs in a worker thread with a timeout and a concurrency limit |
| `src/config/env.ts` | `readR2Config()`: reads and checks the R2 variables |

### Mounting from server startup

Mount the routes through `createApp({ businessRouter })`, so they sit behind the `/api/v1`
origin check and `requireVerifiedUser`. In `src/server.ts`, where `environment`, `database`
and `authentication` are already created:

```ts
const pool = createPool({ DATABASE_URL: environment.databaseUrl });
const storage = createR2Storage(readR2Config());
const pdf = createPdfExtractor();                       // ONE per process: it holds the parse limit
const { service, startWorker } = createPostgresResumeModule({ pool, storage, pdf });

const businessRouter = Router();
businessRouter.use("/resumes", createResumeRouter({ service, authenticate: requireAuthContext }));
const app = createApp({ authentication, database, environment, businessRouter });
const worker = startWorker();
// Shutdown: stop accepting requests → await worker.stop() → storage.close()
//           → authentication.close() → pool.end()
```

Do not use `mountPostgresResumeRoutes(app, …)` with `createApp`: it registers the routes
after `createApp`'s final 404 handler (every resume request would get 404) and would skip the
`/api/v1` origin check. See [Merge notes](#merge-notes).
```

`createApp` already runs the origin check and `requireVerifiedUser` for all of `/api/v1`, so
`requireAuthContext` only confirms `res.locals.auth`. The router runs it before reading any
upload body.

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

- `server.ts` does not mount the resume routes and cleanup worker yet (see
  [Mounting](#mounting-from-server-startup)).
- Assumes one backend instance: the cleanup worker puts every `processing` job back to
  `pending` before each pass (Database Design §5.11). Running several instances needs the
  lease design in Database Design §5.7.
- The live R2 check has not been run.
- Text order follows the PDF's internal order. Unusual two-column layouts may come out
  interleaved, so check a few real Word/LaTeX exports by hand.
- Tests for encrypted PDFs and for 99 + 1 characters split across pages were dropped
  because their fixtures failed; that behavior is untested.

<a id="merge-notes"></a>

## Merge notes: `main` (4bc6cb0) into `feat/authentication`

Owner: Zishi Yang, 2026-11-18. Merging Rongxin's PostgreSQL work from `main` into the auth
branch conflicted in four files. This section records how each was resolved and what else had
to change.

### 1. `backend/src/db/pool.ts`: `main`'s version

| | `main` (kept) | `feat/authentication` (dropped) |
|---|---|---|
| Signature | `createPool(env = process.env)`, URL checked by `readDatabaseUrl()` | `createPool(connectionString)` |
| Types | `export type Db = Pool \| PoolClient` | none |
| Idle-client `error` listener | Logs the whole error | `watchIdleErrors(pool)`, logs only the code |

`main`'s file is used unchanged. Two places outside the conflict had to follow:

- `src/server.ts` calls `createPool({ DATABASE_URL: environment.databaseUrl })`, so the URL
  checked at startup is the one that is connected.
- `src/modules/auth/auth.ts` no longer imports `watchIdleErrors`. At merge time its separate
  rate-limit pool (`new pg.Pool(...)`) got its own `error` listener. The later auth refactor
  replaced that: `server.ts` now creates the rate-limit pool with `createPool()` as well, so
  both pools share `main`'s listener.

Idle-client errors are now logged in full, as the whole error object. A PostgreSQL restart
produces about 100 lines per idle connection, including the client's user, host and database
name. The password is not printed (`pg` keeps it non-enumerable). A shorter log line is a
possible follow-up for the owner of `pool.ts`.

### 2. `backend/src/db/transaction.ts`: this branch's version, with `main`'s rollback handling

**Conflict.** Both sides gave `withTransaction(pool, callback)` a `pool` parameter and discard
the client when `ROLLBACK` fails. They differ in three ways:

| | `main` | `feat/authentication` |
|---|---|---|
| COMMIT result | Not checked | Throws unless PostgreSQL answers `COMMIT` |
| Failed ROLLBACK | `release(true)` and logs the rollback error | `release(rollbackError)`, no log |
| `Database` class | Absent | Present; the auth code shares one transaction through it |

**Resolution.** This branch's file, with `main`'s failed-ROLLBACK handling. `withTransaction` is now:

```ts
export async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard: true | undefined;
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    const commit = await client.query("COMMIT");
    if (commit.command !== "COMMIT") throw new Error("PostgreSQL rolled back an aborted transaction");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      discard = true;                       // never return a connection in an unknown state
      console.error("Transaction rollback failed:", rollbackError);
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
```

The `Database` class is unchanged.

The COMMIT check is kept because a callback might catch a failed statement, for example in
the nested `inTransaction` calls of the application repository. PostgreSQL has then aborted the
transaction and answers COMMIT with ROLLBACK. Without the check this was reported as a
success although nothing was written.

**Test changes** in `tests/unit/db.test.ts` (from `main`):

- The mock client in "a successful transaction commits and releases the client once" now returns
  `{ command }` like a real `pg` client. The old mock returned `undefined`, which the COMMIT check
  rejects.
- The two rollback tests are unchanged: they still expect `release(true)` and the logged
  `rollbackError`.
- New test "a COMMIT answered with ROLLBACK is reported as a failure, not a success".

### 3. `backend/package.json` scripts: this branch's runner, `main`'s migrate script

| Script | Result | Why |
|---|---|---|
| `test` | This branch: unit **and** contract tests | The auth contract tests live in `tests/contract/` |
| `test:db` | `node --env-file-if-exists=.env scripts/test-with-postgres.mjs` | `main`'s glob (`integration/*.db.test.js`) skipped the auth integration tests. `main`'s version also required `TEST_DATABASE_URL`; this one uses it when set (including from `.env`) and otherwise starts a disposable cluster |
| `migrate` | `main`'s `scripts/migrate.mjs` | Validates `DATABASE_URL`, one transaction, `--dry-run` |
| `migrate:down` | Kept from this branch | `main` had none |
| `test:r2` | Unchanged (identical on both sides) | |

`scripts/test-with-postgres.mjs` now skips `r2.test.js`. Because `test:db` loads `.env`, an
`R2_INTEGRATION_TEST=1` there would otherwise make the database suite touch a real bucket.
The live check stays in `npm run test:r2`. Dependencies did not change, so `package-lock.json`
did not conflict.

### 4. `backend/README.md`: both sides combined

| Hunk | Result |
|---|---|
| Command table | This branch's rows (`start`, `dev`, `migrate:down`), plus `npm run migrate -- --dry-run`; `test:db` described as in item 3 |
| Sections after the table | Both kept: "Authentication and authorization" with [Checks](#checks), then `main`'s "PostgreSQL setup and tests", "Application and interview repositories" and "Application list and Dashboard reads". `main`'s `TEST_DATABASE_URL`-only paragraph is merged into Checks |
| Resume status | `main`'s text, plus a pointer to the mounting rule |
| Mounting example | Rewritten (below) |
| Known gaps | Both old lines were out of date. Replaced by "`server.ts` does not mount the resume routes yet" |

**Why the mounting example was rewritten.** `main` documented
`mountPostgresResumeRoutes(app, { authenticate: requireVerifiedUser(authentication) })`.
With `createApp` this does not work:

- It adds `/api/v1/resumes` to `app` after `createApp()` has returned, which places it behind the
  final 404 handler, so every resume request gets 404.
- In any order it bypasses the `/api/v1` origin (CSRF) check and reads the Session twice.

`main`'s HTTP test does not catch this because it uses test middleware on a bare Express app.
[Mounting](#mounting-from-server-startup) now uses `createPostgresResumeModule()` and
`businessRouter`. To agree with Jianye and Rongxin: remove `mountPostgresResumeRoutes`, or make
it take a `Router` and mount at `"/resumes"`.
