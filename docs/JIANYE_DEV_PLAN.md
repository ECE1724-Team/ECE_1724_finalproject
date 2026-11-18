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
| Phase 4: resume service, API routes, cleanup worker | Planned 2026-11-17 (Next steps §2); part of it waits on teammates |
| AI Copilot | Not started |

`npm run typecheck`, `npm test` (15 tests) and `npm run build` pass.

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
- Decisions, file layout, error mapping and blockers: Next steps §2.

## Don't undo these
Worker-thread isolation and the `busy` limit; `If-None-Match` on writes; never accepting a
storage key or user ID from the browser; no text in `unavailable` results; R2 objects of
deleted resumes are removed only by the cleanup worker after the DB commit.

## Known gaps
- Real R2 check (`npm run test:r2`) has never run.
- No tests for encrypted PDFs or "99 + 1 characters split across pages" (fixtures failed).
- Text order follows the PDF's internal order; check a few real Word/LaTeX two-column exports by hand.
- `PdfError` / `StorageError` → HTTP mapping is proposed in Next steps §2 but not yet reviewed by Justin.

## Next steps

### 1. Close out Phases 1–3
- Create a dev-only R2 bucket and run `npm run test:r2`; record the result here.
- Try 3–5 real resume exports (Word, LaTeX, Canva, a scan) and check the extracted text.

### 2. Phase 4: resume service, API routes and cleanup worker

Scope: everything behind `/api/v1/resumes` (list, upload, get, delete, file download) plus
the worker that deletes R2 objects. Rongxin writes the SQL, Zishi provides auth, Justin
reviews API changes. Rules come from Database Design §7.2–7.3, §5.11, §8.5 and Appendix C.4.

**Decisions (2026-11-17)**
- The resume routes are mine.
- I define the repository interfaces (I'm the caller) plus test fakes; Rongxin implements
  them in SQL and reviews the shapes. Fakes live only in `tests/`, never as a runtime fallback.
- Upload parsing uses `multer` 2.x (exact version pinned) with memory storage and limits of
  1 file, 2 MiB, small text fields. Auth runs **before** multer, so bodies from
  unauthenticated users are never read.
- Unit tests only for now. Route tests start the app on a random port and call it with
  Node's built-in `fetch`/`FormData`, so no `supertest`. Real-DB tests wait for a migrate script.
- The cleanup worker runs inside the server process (single instance, Database Design v1.8):
  every 30 s it claims up to 10 jobs; retries after 1 min, 5 min, 30 min, 2 h, then every
  6 h with no limit. Stuck jobs are visible through `last_error_code`.
- If the R2 variables are missing in development, the server still starts but skips the
  resume routes and the worker with one warning, so teammates don't need R2. In production
  (`NODE_ENV=production`) missing R2 config stops startup.
- Deferred: orphan reconciliation (R2 object with no row), a per-user upload limit (not in
  the PRD), streaming downloads (not needed at 2 MiB).

**Files**

| File | Content |
|---|---|
| `src/modules/resumes/repository.ts` | Interfaces and row types only, no SQL (sketch below) |
| `src/modules/resumes/service.ts` | `createResumeService(deps)`: `upload`, `list`, `get`, `download`, `remove`. Takes `userId`; no Express |
| `src/modules/resumes/cleanup-worker.ts` | `startCleanupWorker(deps)` → `{ stop() }`; `runCleanupOnce()` for tests |
| `src/modules/resumes/routes.ts` | `createResumeRouter({ service, authenticate })`: multer, input checks, row → JSON, error → HTTP |
| `tests/fakes/resumes.ts` | In-memory fakes of both repositories |
| `tests/unit/resume-service.test.ts`, `cleanup-worker.test.ts`, `resume-routes.test.ts` | Unit tests |

Interface draft to send to Rongxin (repository returns camelCase objects):

```ts
type Db = Pool | PoolClient;   // the pool, or a client inside a transaction
interface ResumeRepository {
  insert(db: Db, row: NewResumeRow): Promise<void>;
  listLive(db: Db, userId: string): Promise<ResumeRow[]>;       // newest first, with linkedApplicationCount
  getLive(db: Db, userId: string, id: string): Promise<ResumeRow | null>;
  findLiveByObjectKey(db: Db, objectKey: string): Promise<{ id: string } | null>;
  // Own transaction (§7.3): lock resume, then applications; tombstone, unlink, clear text,
  // enqueue `resume_deleted`. Returns null for missing, foreign or already deleted.
  deleteAndUnlink(pool: Pool, userId: string, id: string): Promise<{ unlinkedApplicationCount: number } | null>;
}
interface StorageCleanupRepository {
  enqueue(db: Db, objectKey: string, reason: "resume_deleted" | "upload_rollback"): Promise<void>;
  claimDue(db: Db, limit: number): Promise<CleanupJob[]>; // FOR UPDATE SKIP LOCKED, marks them processing
  complete(db: Db, jobId: string): Promise<void>;
  fail(db: Db, jobId: string, errorCode: string, nextAttemptAt: Date): Promise<void>;
  resetInterrupted(db: Db): Promise<number>;              // at startup: processing → pending
}
```

#### 2a. Can be finished now (only my code, tested with fakes)

1. **Interfaces + fakes** (`repository.ts`, `tests/fakes/resumes.ts`). Send the draft to
   Rongxin as soon as it's written; everything else builds on it.
2. **Upload** (`service.upload`), following §7.2:
   1. `validateResumePdf(bytes, pdf, { signal })`; a `PdfError` goes straight back to the caller.
   2. `id = randomUUID()`, `key = createObjectKey()`, then `storage.putNew(key, bytes, { signal })`.
   3. From here on, **ignore the request's cancel signal** and finish the insert, so a client
      that disconnects doesn't leave a stored file without a row.
   4. Insert: `succeeded` with text, page count and character count, or `text_unavailable`
      with the counts and no text; `size_bytes` = real byte length; `mime_type` = `application/pdf`.
   5. If the insert fails:
      - Postgres returned an error (it has a SQLSTATE `code`), so the row definitely doesn't
        exist: delete the object. If that fails, enqueue `upload_rollback`; if that also fails,
        log the key.
      - No reply (connection lost), so the outcome is unknown: `findLiveByObjectKey`. Found →
        treat as success. Not found → clean up as above. Lookup also fails → keep the object,
        log the key, return 503. **Never delete the object of a row that might exist.**
   6. Return the public resume with `linkedApplicationCount: 0`.
3. **List / get**: thin wrappers; `null` → not found.
4. **Download**: `getLive`, then `storage.read(key, { signal })`. If R2 returns `null`,
   check the row again: now deleted → 404 (deleted while we were reading); still live → 500 and log it.
5. **Delete** (`service.remove`): call `deleteAndUnlink`; `null` → 404; otherwise return the
   count. No R2 call here: the worker deletes the file after the commit.
6. **Cleanup worker**:
   - On start: `resetInterrupted`, one pass right away, then every 30 s. `stop()` waits for
     the running pass. If a whole pass fails (e.g. DB down), log it and try on the next tick.
   - Per job: if `findLiveByObjectKey` finds a live row, complete the job without deleting
     and log `still_referenced` (guards against a bug ever deleting a live resume). Otherwise
     `storage.delete` (safe to repeat) → `complete`; on error → `fail` with the `StorageError`
     code and the next retry time from `attempt_count`.
7. **Routes** (`createResumeRouter`):
   - `authenticate` is passed in (Zishi's `requireVerifiedUser` later, a fake in tests). The
     user ID comes only from `res.locals.auth.userId`.
   - `:resumeId` that isn't a UUID → 404 (avoids a Postgres cast error and matches "not found").
   - Upload input: request not `multipart/form-data` → 415; missing `file` or `name`, or more than one file → 400;
     `name` trimmed and 1–200 characters, otherwise 422. File name: the browser's name with any
     path, control characters and extra length (over 255) removed, falling back to `resume.pdf`.
   - `201` with a `Location: /api/v1/resumes/{id}` header, as in the contract.
   - Cancellation: one `AbortController` per request, aborted when the client disconnects
     before the response is finished.
   - Download headers: `Content-Type: application/pdf`, `Content-Length`,
     `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and
     `res.attachment(fileName)` (handles non-ASCII names). The frontend previews the same
     endpoint through a Blob URL.
   - Response mapping: `succeeded` → `textStatus: "available"`, `text_unavailable` →
     `"unavailable"`. Never return `objectKey` or extracted text. The upload warning is shown
     by the frontend from `textStatus`; the contract has no separate warning field.
   - Express 5 passes errors thrown in async handlers to the error middleware, so one error
     handler at the end of the router does all the mapping:

     | Error | HTTP | `error.code` |
     |---|---|---|
     | File over 2 MiB (multer limit or `too_large`) | 413 | `PDF_TOO_LARGE` |
     | `invalid_pdf` | 422 | `PDF_INVALID` |
     | `too_many_pages` | 422 | `PDF_TOO_MANY_PAGES` |
     | `unreadable_encryption` | 422 | `PDF_PASSWORD_PROTECTED` |
     | `busy` | 503 + `Retry-After: 5` | `PDF_BUSY` |
     | `timeout`, `processing_failed` | 503 | `PDF_PROCESSING_FAILED` |
     | Any `StorageError`, database unreachable | 503 | `SERVICE_UNAVAILABLE` |
     | `cancelled` | nothing sent (the client is gone) | — |
     | Anything else | 500 | `INTERNAL_ERROR` |

     Body format is the contract's `{ error: { code, message } }`, with the `PdfError` messages
     for file problems. Logs never contain file bytes or extracted text.
8. **Contract and docs**: add 413, 503 and 500 to the resume operations in `endpoints.json`,
   list the error codes above, and send the change to Justin. Update `backend/README.md`:
   resume routes are mine, plus how to mount the router and start the worker.
9. **Tests** (all with fakes):
   - Upload: available, unavailable, each rejection, insert failure with a known and an unknown
     outcome (found / not found / lookup fails), cleanup fallback chain, client cancel before
     and after the R2 write.
   - Reads: owner filter, deleted and foreign → 404, ordering, download when R2 returns `null`.
   - Delete: 404, the count, no R2 call.
   - Worker: success, retry times, `still_referenced` guard, `resetInterrupted`, `stop()`.
   - Routes: every row of the error table, 401 from the fake auth **without reading** a 3 MiB
     body, non-UUID IDs, download headers, non-ASCII file names.

Order: 1 → send the interface to Rongxin → 2–5 → 6 → 7 → 8. Steps 2–7 each get their tests in the same change.

#### 2b. Blocked on teammates

| What | Waiting for | Until then |
|---|---|---|
| SQL for both repositories | Rongxin | Fakes |
| Migration 006 `storage_cleanup_jobs` | Rongxin | Worker and `upload_rollback` tested with fakes |
| `createPool()` instead of the import-time pool in `db/pool.ts` | Rongxin | My modules only take a pool parameter |
| `npm run migrate` and a local Postgres, then an opt-in real-DB test (like `test:r2`) | Rongxin | Unit tests only |
| `requireVerifiedUser` / `VerifiedAuthContext` code | Zishi | Fake auth in tests |
| Origin/CSRF check for cookie-authenticated POST/DELETE | Zishi | — |
| `app.ts` / `server.ts`: mount the router, start the worker, shut down cleanly | Zishi (app setup) + me | Wiring sketch below |
| Linking a resume through the application update: same owner, live, `succeeded` or `text_unavailable`, checked in the same transaction with resume-before-application lock order | Zishi / Rongxin (application API) | — |
| Review of the error table and contract changes | Justin | Proposed table above |
| Real R2 round trip | Me (dev bucket) | — |

Wiring once `app.ts` exists:

```ts
const pool = createPool();
const storage = createR2Storage(readR2Config());
const pdf = createPdfExtractor();                       // one per process
const resumes = createResumeService({ pool, storage, pdf, resumeRepo, cleanupRepo });
app.use("/api/v1/resumes", createResumeRouter({ service: resumes, authenticate: requireVerifiedUser }));
const worker = startCleanupWorker({ pool, storage, resumeRepo, cleanupRepo });
// On SIGTERM: stop accepting requests, await worker.stop(), storage.close(), await pool.end().
```

**Phase 4 is done (module level) when** all tests above pass with fakes, Rongxin has accepted
the interfaces, and Justin has accepted the contract changes. The real-DB and real-auth checks
belong to "Done when (integrated)" below.

### 3. Agree with teammates (small interface examples are enough)
- **Zishi:** when `requireVerifiedUser` / `VerifiedAuthContext` land; Origin/CSRF check for
  cookie POST/DELETE; who sets up `app.ts` / `server.ts`; the resume checks inside the
  application update (2b table).
- **Rongxin:** agreed 2026-11-17 (Database Design Appendix C.4). Still to send: my repository
  interface draft. Still to ask: dates for 006, `createPool()` and an `npm run migrate` script;
  `resetInterrupted` added to the cleanup SQL.
- **Justin:** the error table and the 413/503/500 additions; the upload warning and "AI can't
  read" badge come from `textStatus`; PDF preview via Blob URL. Tell him: the resume list gains
  `linkedApplicationCount` and loses pagination (endpoints 1.10.0); a 404 on a retried DELETE
  means the resume is already gone.

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
