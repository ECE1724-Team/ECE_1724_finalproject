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
| `npm test` | Compiles to `dist/tests/` and runs the offline unit tests (no credentials, database or network needed) |
| `npm run build` | Compiles `src/` to `dist/` for running or deploying |
| `npm run test:r2` | Optional real R2 check, see below |

`dist/` is build output and is not committed. Deploy it together with `node_modules`
(the PDF parser loads font data from `pdfjs-dist` at runtime).

## Resume storage and PDF parsing (R2 / PDF)

Owner: Jianye Zhou (progress and plan: [JIANYE_DEV_PLAN.md](../docs/JIANYE_DEV_PLAN.md)).
File rules: [PRD §5.2](../docs/PRD.md). Upload and delete transactions:
[Database Design §7.2–7.3](../docs/Database_Design.md).

**Status:** the R2 adapter, PDF parsing, the resume service, the `/api/v1/resumes` routes and
the R2 cleanup worker are done and unit-tested with in-memory fakes. Still missing (other
owners): the SQL behind the repository interfaces and migration 006 (Rongxin), the
`requireVerifiedUser` middleware (Zishi), and mounting everything in `app.ts`/`server.ts`.

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

### Mounting (once `app.ts` exists)

```ts
const pool = createPool();
const storage = createR2Storage(readR2Config());
const pdf = createPdfExtractor();                 // ONE per process: it holds the parse limit
const deps = { pool, storage, resumes: resumeRepository, cleanup: cleanupRepository };
const service = createResumeService({ ...deps, pdf });
app.use("/api/v1/resumes", createResumeRouter({ service, authenticate: requireVerifiedUser }));
const worker = startCleanupWorker(deps);
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

- No real-database or real-auth tests yet; everything above is tested with fakes.
- Assumes one backend instance: the cleanup worker puts every `processing` job back to
  `pending` before each pass (Database Design §5.11). Running several instances needs the
  lease design in Database Design §5.7.
- The live R2 check has not been run.
- Text order follows the PDF's internal order. Unusual two-column layouts may come out
  interleaved, so check a few real Word/LaTeX exports by hand.
- Tests for encrypted PDFs and for 99 + 1 characters split across pages were dropped
  because their fixtures failed; that behavior is untested.
