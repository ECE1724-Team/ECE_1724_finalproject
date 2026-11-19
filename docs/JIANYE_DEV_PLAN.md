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

Details live in the code comments, [backend/README.md](../backend/README.md) and Database
Design; this log keeps what was decided and why.

### 2026-11-15: Phases 1–3 (R2 adapter, PDF parsing, file rules)
- R2 adapter with four operations (`putNew` / `read` / `head` / `delete`); writes use
  `If-None-Match: *` so they never overwrite; keys are random and server-side only.
- PDF.js runs in a worker thread that can be killed on timeout or cancel, max 2 per process
  (`busy` beyond that). Modules don't depend on Express or the database.
- Simplified right after: only the 4 R2 env vars, limits as code constants, `read` returns the
  whole file (≤ 2 MiB, no stream).

### 2026-11-15 → 11-17: Text-unavailable resumes (confirmed 11-17)
Readable PDFs without usable text are stored and linkable instead of rejected, with no saved
text (`textStatus: "unavailable"`, `parse_status = 'text_unavailable'`). Upload is synchronous;
rejected files leave nothing behind. Rules: PRD §5.2.

### 2026-11-17: Agreements with Rongxin
Repository interfaces I can fake, pool passed in at startup, server-generated resume id and
key, unpaginated list with `linkedApplicationCount`, 404 for deleted/foreign resumes, cleanup
SQL by Rongxin and worker by me. Recorded in Database Design Appendix C.4 and §5.11.

### 2026-11-17: Phase 4 module work (service, routes, cleanup worker)
- The resume routes are mine; I defined `repository.ts` and the fakes, Rongxin implements the SQL.
- Upload: once the PDF is in R2 the insert always finishes; an unclear insert is looked up by
  `object_key` before any delete. Delete never touches R2; the worker does, after the commit.
- Routes: auth before multer; multer must use `defParamCharset: "utf8"` (latin1 garbles Chinese
  file names). Error codes in `endpoints.json` 1.11.0 and backend README.
- Worker: every 30 s, `requeueProcessing` then claim 10; skips keys of live resumes. Relies on a
  single backend instance.
- Review fixes: PostgreSQL errors are detected with `instanceof DatabaseError` (a socket
  `EPIPE` used to look like a SQLSTATE and skip the lookup); all 5xx except `PDF_BUSY` are logged.
- Tests: in-memory fakes; route tests run a real Express server with Node's `fetch`.
- Shared docs synced (Database Design v1.13, PRD ownership row). Not yet confirmed by Rongxin or Justin.

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
"2026-11-17: Phase 4 module work". What remains needs someone else's code first.

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
  ordering, locking and return values) and `tests/fakes/resumes.ts` (expected behavior);
  the cleanup SQL contract is in Database Design §5.11.
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
