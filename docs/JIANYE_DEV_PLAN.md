# Jianye's Dev Plan and Progress Log

Owner: Jianye Zhou. Areas: resume storage (Cloudflare R2), PDF parsing, and the AI Copilot.
This is my own working record. What the team needs lives in shared docs:
usage and API-route rules in [backend/README.md](../backend/README.md), file rules in
[PRD §5.2](PRD.md), upload/delete transactions in [Database Design §7.2–7.3](Database_Design.md),
AI behavior in [AI Design](AI_Design.md), routes in [endpoints.json](endpoints.json).

## Status (2026-11-17)

| Item | State |
|---|---|
| Phase 1: test setup | Done |
| Phase 2: R2 adapter | Done, unit-tested with a fake client. **Real R2 round trip not run yet** (needs a dev bucket) |
| Phase 3: PDF parsing and acceptance rules | Done, unit-tested |
| Phase 4: resume service, API routes, cleanup worker | Module work done and unit-tested with fakes; SQL, auth and wiring wait on teammates (Next steps §2) |
| AI Copilot | Not started |

`npm run typecheck`, `npm test` (42 tests) and `npm run build` pass.

## Progress log

### 2026-11-15: Phases 1–3 built
- Added `@aws-sdk/client-s3` and `pdfjs-dist`; tests run on Node's built-in runner (no
  test framework). Node 26. Backend stays CommonJS; only the PDF worker is ESM (`.mts`)
  because PDF.js is ESM-only.
- R2 adapter (`r2.ts`): four operations `putNew` / `read` / `head` / `delete`, random
  server-side keys, and `If-None-Match: *` so a write never overwrites.
- PDF parsing (`extractor.ts`, `worker.mts`): each parse runs in a worker thread that is
  killed on timeout or cancel, because PDF.js cannot be interrupted otherwise. Max 2 at a
  time per process; more fail fast with `busy`.
- Acceptance rules (`pdf-policy.ts`): 2 MiB, 1–2 pages, real PDF, not password-protected.
- Fixtures build fictional PDFs in code; no real resumes in the repo.
- Key decisions: modules don't depend on Express or the database, so they can be tested
  and reused by the cleanup worker; storage keys only ever come from the server.

### 2026-11-15: Simplification pass
- Config cut to the 4 R2 variables + `R2_INTEGRATION_TEST`; region fixed to `auto`;
  timeouts and limits became code constants instead of env vars.
- `read` returns the whole file as bytes instead of a stream (files ≤ 2 MiB). This removed
  the hardest-to-read code.
- Removed duplicate checks and unused test code (PDF encryption helpers).

### 2026-11-15 → 11-17: Text-unavailable resumes
- Readable PDFs without usable text (scanned, image-only) are now **stored, not rejected**:
  viewable, downloadable and linkable, but the AI can't use them and the UI warns.
  `validateResumePdf` returns `textStatus: "available"` (with text) or `"unavailable"`
  (with no text at all, so partial text can never reach the AI). `insufficient_text` error removed.
- Proposed 11-15, **confirmed 11-17**. DB stores it as `parse_status = 'text_unavailable'`
  with `extracted_text = NULL` (migration updated in `db5cb92`). API field `Resume.textStatus`.

### 2026-11-16 → 11-17: Docs and agreements
- Merged my handoff notes into `backend/README.md`; this file became my personal plan.
- Upload is **synchronous** (confirmed 11-17): parse first, write to R2 and the database only
  for accepted files; nothing is stored for rejected ones.
- Added `tests/tsconfig.json` so VS Code type-checks tests.

### 2026-11-17: Agreements with Rongxin (Database Design Appendix C.4)
- Repository functions sit behind TypeScript interfaces I can fake. Single statements take a
  client; atomic workflows (resume delete, AI turn steps) are one function with their own transaction.
- Pool is created at startup with `createPool()` and passed in, like `createR2Storage(readR2Config())`.
- Upload generates the resume id (`randomUUID()`) and object key before writing R2; unknown insert
  outcome → look up by `object_key` before deleting the object.
- Resume list: all live resumes, newest first, not paginated, with `linkedApplicationCount`
  (endpoints 1.10.0). Deleted, missing or foreign resume → 404 everywhere.
- Cleanup: Rongxin writes migration 006 and the enqueue/claim/complete/fail SQL; I write the worker
  and pick the retry schedule. Reasons `resume_deleted`, `upload_rollback` (no CHECK). Orphan
  reconciliation deferred.

### 2026-11-17: Phase 4 planned
- The resume API routes are mine. I define the repository interfaces; Rongxin implements the SQL.
- Upload parsing with `multer`; the cleanup worker runs in the server process; unit tests
  with fakes until there is a migrate script.

### 2026-11-17: Phase 4 module work done
Everything that didn't need teammates' code. 40 unit tests pass (25 new).
- `repository.ts`: `ResumeRepository` / `StorageCleanupRepository` interfaces with comments
  on ordering, locking and return values. Differences from the draft: `insert` and
  `findLiveByObjectKey` return the full row, so a recovered upload can be returned directly.
- `service.ts`: upload / list / get / download / remove, following §7.2–7.3. Upload: validate →
  R2 → insert; once the file is in R2 the client's cancel is ignored so the insert always
  finishes. Failed insert: PostgreSQL error (SQLSTATE) → delete the object, else queue
  `upload_rollback`, else log the key; no reply → look up by `object_key` first; lookup also
  fails → keep the object, 503. Download: object missing → 404 if the resume was deleted
  meanwhile, otherwise 500. Delete never touches R2.
- `errors.ts`: `ServiceUnavailableError`, and telling a definite DB failure (SQLSTATE, not class
  08) from "database unreachable" (classes 08/53/57P, network errors).
- `cleanup-worker.ts`: claim 10 every 30 s, never two passes at once, `resetInterrupted` at
  start, retries after 1 min / 5 min / 30 min / 2 h, then every 6 h. Skips (and completes) a
  job whose key still belongs to a live resume.
- `routes.ts`: auth runs before multer; multer 2.5.0 (pinned) with 2 MiB, one file, one field,
  and `defParamCharset: "utf8"` (its default latin1 garbles Chinese file names). Non-UUID id
  → 404. Download headers: `application/pdf`, `private, no-store`, `nosniff`, RFC 6266 file
  name. Error codes as in backend/README "HTTP errors"; 415 is only for non-multipart
  requests, a non-PDF file is 422 `PDF_INVALID`.
- Tests: `tests/fakes/resumes.ts` (in-memory repositories, storage, extractor) and
  `resume-service`, `cleanup-worker`, `resume-routes` tests. Route tests run a real Express
  server on a random port with Node's `fetch`; no `supertest`.
- `endpoints.json` 1.11.0: 413/500/503 responses and the error codes for the resume routes.
  `backend/README.md`: files, mounting, HTTP errors, rules.
- `npm audit` reports 3 moderate issues from `node-pg-migrate`'s `glob`; they were there before multer.

### 2026-11-17: Phase 4 review fixes
42 unit tests pass; each new check fails on the code before these fixes.
- A PostgreSQL answer is now `instanceof DatabaseError` (pg), not a five-character `code`:
  `EPIPE` matched the old pattern, so a socket error skipped the row lookup and returned 500.
- The cleanup worker calls `resetInterrupted` (renamed `requeueProcessing`) before **every** pass, not only at start. Before,
  a database blip during a pass left the whole claimed batch `processing` until the next restart.
  Safe because there is one instance and passes never overlap.
- Logging: every 5xx except `PDF_BUSY` is logged (before, only 500), and the worker logs
  non-storage job errors (`unexpected_error`) with their stack.
- A `name` over multer's 1 KiB `fieldSize` is 422 `VALIDATION_ERROR` like any too-long name (was 400).

## Don't undo these
Worker-thread isolation and the `busy` limit; `If-None-Match` on writes; never accepting a
storage key or user ID from the browser; no text in `unavailable` results; R2 objects of
deleted resumes are removed only by the cleanup worker after the DB commit; auth before
reading the upload body; finishing the insert after the R2 write even if the client left;
looking a row up before deleting the object of an unclear insert; the worker's live-resume check.

## Known gaps
- Real R2 check (`npm run test:r2`) has never run.
- No tests for encrypted PDFs or "99 + 1 characters split across pages" (fixtures failed).
- Text order follows the PDF's internal order; check a few real Word/LaTeX two-column exports by hand.
- HTTP error codes are implemented and in `endpoints.json` 1.11.0, but not yet reviewed by Justin.
- No real-database or real-auth test yet; the resume module is tested with fakes only.
- **Assumes one backend instance.** The cleanup worker calls `requeueProcessing` before every
  pass, and AI runs use startup recovery (Database Design v1.8). With two or more instances,
  switch to the lease design kept in Database Design §5.7. For cleanup alone the worst case is
  a job processed twice, which is harmless (deletes are idempotent and skip live resumes).

## Next steps

### 1. Close out Phases 1–3
- Create a dev-only R2 bucket and run `npm run test:r2`; record the result here.
- Try 3–5 real resume exports (Word, LaTeX, Canva, a scan) and check the extracted text.

### 2. Phase 4: what's left (blocked on teammates)

The module work (2a in the original plan) is done; see the Progress log entry
"2026-11-17: Phase 4 module work done". What remains needs someone else's code first.

| What | Waiting for | Until then |
|---|---|---|
| SQL for `ResumeRepository` and `StorageCleanupRepository` (`src/modules/resumes/repository.ts`) | Rongxin | Fakes in `tests/fakes/resumes.ts` |
| Migration 006 `storage_cleanup_jobs`, including `requeueProcessing` (all `processing` → `pending`; the worker calls it before each pass) | Rongxin | Worker and `upload_rollback` tested with fakes |
| `createPool()` instead of the import-time pool in `db/pool.ts` | Rongxin | My modules only take a pool parameter |
| `npm run migrate` and a local Postgres, then an opt-in real-DB test (like `test:r2`) | Rongxin | Unit tests only |
| `requireVerifiedUser` / `VerifiedAuthContext` code | Zishi | Fake auth in route tests |
| Origin/CSRF check for cookie-authenticated POST/DELETE | Zishi | — |
| `app.ts` / `server.ts`: mount the router, start the worker, shut down cleanly (sketch in backend/README "Mounting") | Zishi (app setup) + me | — |
| In development without R2 variables: start anyway, skip resume routes and the worker with one warning; in production, fail to start | Me, together with the `server.ts` wiring | — |
| Linking a resume through the application update: same owner, live, `succeeded` or `text_unavailable`, checked in the same transaction with resume-before-application lock order | Zishi / Rongxin (application API) | — |
| Review of the error codes and `endpoints.json` 1.11.0 | Justin | Implemented as proposed |
| Real R2 round trip | Me (dev bucket) | — |

Still deferred: orphan reconciliation (R2 object with no row), a per-user upload limit (not
in the PRD), streaming downloads (not needed at 2 MiB).

**Phase 4 is done** when Rongxin has accepted the interfaces, Justin has accepted the
contract, and the integrated checks in "Done when" below pass.

### 3. Agree with teammates (small interface examples are enough)
- **Zishi:** when `requireVerifiedUser` / `VerifiedAuthContext` land; Origin/CSRF check for
  cookie POST/DELETE; who sets up `app.ts` / `server.ts`; the resume checks inside the
  application update (table above).
- **Rongxin:** send `src/modules/resumes/repository.ts` (the interfaces, with comments on
  ordering, locking and return values) and `tests/fakes/resumes.ts` (expected behavior).
  Ask for dates for the SQL, 006, `createPool()` and an `npm run migrate` script.
- **Justin:** review `endpoints.json` 1.11.0 (413/500/503 and the error codes in the upload
  description). The upload warning and "AI can't read" badge come from `textStatus`; preview
  uses a Blob URL of the file endpoint. The list has `linkedApplicationCount` and no
  pagination; a 404 on a retried DELETE means the resume is already gone.

### 4. AI Copilot (later)
- AI reads saved text from the resume row via the application's current `resumeId`; it
  never re-downloads or re-parses the PDF.
- `text_unavailable` linked resume → tell the user it's linked but unreadable (PRD FR-30).
- Prepare test data: V1/V2 resumes, two resumes with identical text, deleted and
  text-unavailable cases. A DB read failure must not look like "no resume".

## Done when (integrated, with real auth and DB)
Upload survives reload; only the owner can view/download; one file linked to two
applications; replacing one link leaves the other; a rejected replacement keeps the old
link; delete works while R2 is down and the object is cleaned up later; a restarted worker
finishes pending cleanup; anonymous, unverified, revoked-session and other-user requests
are all rejected. Target for the non-AI workflow: 2026-11-25.
