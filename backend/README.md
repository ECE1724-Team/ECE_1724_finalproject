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
| `npm test` | Compiles to `dist/tests/` and runs the offline unit and contract tests (no credentials, database or network needed) |
| `npm run test:db` | Also runs the PostgreSQL integration tests (auth flows, ownership checks, SMTP activation), see [Checks](#checks) |
| `npm run build` | Compiles `src/` to `dist/` for running or deploying |
| `npm start` | Runs the compiled server (`dist/server.js`), reading `.env` if present |
| `npm run dev` | `build` + `start` (no watch mode: the PDF worker only exists as compiled output) |
| `npm run migrate` / `npm run migrate:down` | Applies all pending migrations / rolls back the latest one. `migrate:down` can destroy data; use it only on a development or test database |
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
  application/resume/workspace/conversation IDs. Still scope every SQL statement by
  `res.locals.auth.userId`.
- Confirmed settings (2026-11-11): 7-day Sessions; verification/reset links last 900 s and only the
  latest link per user and purpose works; 60 s cooldown and at most 5 emails per 15 min per
  recipient and purpose; a replacement link becomes active only after SMTP accepts it.
- Production requires HTTPS origins. Set `TRUST_PROXY_HOPS` only for a known reverse-proxy chain.

<a id="checks"></a>

### Checks

`npm run test:db` creates a disposable PostgreSQL cluster from the local server binaries
(`pg_config --bindir`) on a private Unix socket, and each test creates and drops its own randomly
named database. It must run as a non-root user allowed to create local sockets. Alternatively set
`TEST_DATABASE_URL` to an isolated test server where the user may `CREATE DATABASE`. Never point it
at the application database. SMTP tests use a localhost-only server and send no real mail.

## Resume storage and PDF parsing (R2 / PDF)

Owner: Jianye Zhou (progress and plan: [JIANYE_DEV_PLAN.md](../docs/JIANYE_DEV_PLAN.md)).
File rules: [PRD §5.2](../docs/PRD.md). Upload and delete transactions:
[Database Design §7.2–7.3](../docs/Database_Design.md).

**Status:** the R2 adapter, PDF parsing, the resume service, the `/api/v1/resumes` routes and
the R2 cleanup worker are done and unit-tested with in-memory fakes. `requireVerifiedUser` and
`createPool()` exist, and an integration test runs the resume router behind real auth. Still
missing (other owners): the SQL behind the repository interfaces and migration 006 (Rongxin),
and mounting the router and worker in `server.ts`.

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
| `src/modules/resumes/repository.ts` | `ResumeRepository` and `StorageCleanupRepository` interfaces (SQL implemented separately) |
| `src/modules/resumes/pdf-policy.ts` | `validateResumePdf()`: the PRD file rules |
| `src/integrations/object-storage/r2.ts` | `createR2Storage()`, `createObjectKey()` |
| `src/integrations/pdf/extractor.ts` | `createPdfExtractor()`: parses PDFs in a worker thread with a timeout and a concurrency limit |
| `src/config/env.ts` | `readR2Config()`: reads and checks the R2 variables |

### Mounting (once the repository SQL exists)

In `src/server.ts`, where `pool` (from `createPool(environment.databaseUrl)`) and
`authentication` are already created:

```ts
const storage = createR2Storage(readR2Config());
const pdf = createPdfExtractor();                 // ONE per process: it holds the parse limit
const deps = { pool, storage, resumes: resumeRepository, cleanup: cleanupRepository };
const service = createResumeService({ ...deps, pdf });
const businessRouter = Router();
businessRouter.use("/resumes", createResumeRouter({ service, authenticate: requireAuthContext }));
const app = createApp({ authentication, database, environment, businessRouter });
const worker = startCleanupWorker(deps);
// On shutdown: stop accepting requests, await worker.stop(), storage.close(), then
// authentication.close() and pool.end().
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

- No real-database resume tests yet (the repositories are fakes). The routes run behind real
  auth in `tests/integration/http.test.ts`.
- Assumes one backend instance: the cleanup worker puts every `processing` job back to
  `pending` before each pass (Database Design §5.11). Running several instances needs the
  lease design in Database Design §5.7.
- The live R2 check has not been run.
- Text order follows the PDF's internal order. Unusual two-column layouts may come out
  interleaved, so check a few real Word/LaTeX exports by hand.
- Tests for encrypted PDFs and for 99 + 1 characters split across pages were dropped
  because their fixtures failed; that behavior is untested.
