# Jianye's Dev Plan and Progress Log

Owner: Jianye Zhou. Areas: resume storage (Cloudflare R2), PDF parsing, and the AI Copilot.
This is my own working record. What the team needs lives in shared docs:
usage and API-route rules in [backend/README.md](../backend/README.md), file rules in
[PRD §5.2](PRD.md), upload/delete transactions in [Database Design §7.2–7.3](Database_Design.md),
AI behavior in [AI Design](AI_Design.md), routes in [endpoints.json](endpoints.json).

## R2 / PDF status (2026-11-19)

| Area | Current state |
|---|---|
| Phases 1–3 | Test setup, R2 adapter, PDF parser and acceptance policy implemented. Live R2 verification and two parser fixtures remain open. |
| Phase 4 | Five resume routes, service, cleanup worker, PostgreSQL repositories, migration 006, verified sessions and Origin checks are available. The server entry point still needs to connect them. |
| Application API and frontend | The team has implemented the application routes and opened a PR. Justin's review is pending. Use that PR for the browser handoff. |
| Environment | Development branch ready. Jianye will fill in the local R2 settings later. Stage 1 can proceed now. |
| AI Copilot | Later work. Its input is the saved text of the currently linked resume. |

The 42-test result recorded on November 17 covered the earlier module work. Current integration coverage is split across two tests. One uses real sessions with fake resume repositories and a fake PDF extractor. The other uses real resume SQL and PDF extraction with test identities. Both use fake storage. [Session HTTP test](../backend/tests/integration/http.test.ts) · [PostgreSQL resume HTTP test](../backend/tests/integration/resume-http.db.test.ts)

## Phase 4 closeout

Jianye owns the two stages below. Track **backend acceptance** and the **team browser check** separately. The non-AI workflow target is November 25. Paths under `src/` and `tests/` and all npm commands below are relative to `backend/`.

### Stage 1 — Connect the server and verify the backend locally

| Files | Code and tests |
|---|---|
| `src/config/env.ts`, `tests/contract/configuration.test.ts` | Reuse `readR2Config`. In development or test, four empty R2 settings disable resumes with one startup warning. Reject partial or invalid settings in every environment and missing settings in production. Test each case, including a valid configuration. Validate locally so a temporary R2 outage still permits startup. |
| `src/server.ts`, `src/modules/resumes/postgres-module.ts`, `src/modules/resumes/routes.ts` | Use the existing main pool, one R2 client and one PDF extractor. Add `/resumes` to the shared business router passed to `createApp`, alongside the application routes when their PR lands. Use `requireAuthContext` after the common Origin and session checks. Start one cleanup worker when resumes are enabled. On shutdown, drain HTTP requests and stop the worker before closing R2, authentication and the existing pools. |
| `tests/integration/resume-http.db.test.ts` | Exercise the same router composition as startup. Use the verified cookies and migrated database from `tests/helpers/auth-fixture.ts`, the real PDF extractor and `FakeStorage`. Cover upload, list, metadata, download and delete. Use the existing worker restart and delayed-insert tests in `resume-workflow.db.test.ts` for recovery. |
| `tests/fixtures/pdf.ts`, `tests/unit/pdf.test.ts`, `tests/unit/resume-routes.test.ts` | Add a small password-required PDF and a two-page PDF with 99 non-whitespace characters on page one and one on page two. Exercise the real parser. Check the exact 2 MiB limit through multipart upload as well as the existing over-limit rejection. |

**Acceptance**

- [ ] From `backend/`, `npm run typecheck`, `npm test`, `npm run test:db` and `npm run build` pass without cloud credentials. With the other backend settings valid and R2 blank, development starts with one warning, serves `/health` and skips the resume routes and worker. Invalid configuration names the setting without printing its value.
- [ ] A verified owner uploads a PDF (201), can list it on a fresh request, and downloads identical bytes with private cache headers. Anonymous and revoked sessions get 401, an unverified session gets 403, an untrusted write origin gets 403, and another verified user gets 404 on the owner's file and delete endpoints.
- [ ] A valid PDF of exactly 2,097,152 bytes is accepted. One extra byte gives 413. The password-required PDF gives `PDF_PASSWORD_PROTECTED` (422). The 99 + 1 fixture yields `available`. A scan yields `unavailable` with SQL `extracted_text IS NULL`. Rejected files create neither a resume row nor a storage object.
- [ ] With a simulated storage outage, upload/download report 503, while metadata reads and database deletion still work. After deletion the file endpoint gives 404. A fresh worker finishes the persisted cleanup job when storage recovers and leaves other live files intact.

### Stage 2 — Verify real R2 and hand off the browser workflow

| Files or owner | Work and evidence |
|---|---|
| Jianye · local `.env`, `tests/integration/r2.test.ts` | When ready, configure the four R2 settings for a private development-only bucket with bucket-scoped read/write access. Run the existing opt-in test with `R2_INTEGRATION_TEST=1 npm run test:r2`. Record the date and actual pass or skip. |
| Jianye · `src/server.ts` via `npm start`, backend README, this log | With the other backend settings in place, use `npm run migrate`, then `npm run build` and `npm start`. Run one round trip through the running API with a verified session and real R2. Use fictional Word, LaTeX two-column, Canva and scan samples to check reading order and text availability. Record the outcomes here and update the README's startup status after verification. |
| Team · application API PR and Justin's UI | Once Justin confirms the PR, use its reviewed update contract. The current OpenAPI specifies a full application PUT, so preserve the other fields and interviews when changing `resumeId`. Justin owns UI and OpenAPI changes. Jianye verifies file behavior and supplies the samples. |

**Backend acceptance**

- [ ] The R2 test actually executes. It verifies conditional writes, identical bytes, metadata, repeat deletion and absence. A skipped test leaves cloud acceptance pending.
- [ ] Through the running API, upload and re-fetch a resume, preview/download the original bytes and delete it. Verify immediate loss of API access, then confirm the cleanup job is `done` and the object is absent in the dev bucket. Record whether names, headings and column order remain readable in each text export and whether the scan is marked unavailable. Stop the running server with SIGTERM and confirm it exits cleanly. Run one backend worker for this database and bucket.

**Team browser check** · Target November 25, after the application PR and UI are available.

- [ ] With mock data off in Chrome and Edge, upload through the resume dialog and reload. Check the actual PDF preview, download, text-unavailable warning on upload and selection, and link counts. If an upload response is lost, refresh the list before retrying.
- [ ] Link V1 to two applications. Reject an invalid replacement and verify both links still point to V1. Upload V2 and switch one application to it. Verify the other still uses V1 and both retain their other fields and interviews. Link both to V1 again, confirm the displayed count of two, delete V1, and verify two links were removed and both applications remain.

### Scope of cleanup

Queue committed deletions. On a confirmed insert failure, try deleting the object immediately and enqueue it if deletion fails. If an insert's outcome is unknown, a lookup may briefly find nothing before PostgreSQL commits. Keep the object in that case. A crash between writing the file and saving the row can leave an orphan. Automatic bucket reconciliation, multi-instance worker leases, per-user quotas and streaming downloads remain deferred. [Database Design §7.2](Database_Design.md#72-upload-and-parsing)

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
retaining the object while an insert outcome is unclear; the worker's live-resume check.

## AI Copilot (later)
- AI reads saved text from the resume row via the application's current `resumeId`; it
  never re-downloads or re-parses the PDF.
- `text_unavailable` linked resume → tell the user it's linked but unreadable (PRD FR-30).
- Prepare test data: V1/V2 resumes, two resumes with identical text, deleted and
  text-unavailable cases. A DB read failure must not look like "no resume".
