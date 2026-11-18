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
| Phase 4: resume upload/delete workflow | Not started |
| Resume HTTP routes, cleanup worker | Not started |
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

## Don't undo these
Worker-thread isolation and the `busy` limit; `If-None-Match` on writes; never accepting a
storage key or user ID from the browser; no text in `unavailable` results; R2 objects of
deleted resumes are removed only by the cleanup worker after the DB commit.

## Known gaps
- Real R2 check (`npm run test:r2`) has never run.
- No tests for encrypted PDFs or "99 + 1 characters split across pages" (fixtures failed).
- Text order follows the PDF's internal order; check a few real Word/LaTeX two-column exports by hand.
- `PdfError` / `StorageError` → HTTP status mapping not agreed with Justin yet.

## Next steps

### 1. Close out Phases 1–3
- Create a dev-only R2 bucket and run `npm run test:r2`; record the result here.
- Try 3–5 real resume exports (Word, LaTeX, Canva, a scan) and check the extracted text.

### 2. Phase 4: resume workflow module (`src/modules/resumes/`)
- Upload: follow Database Design §7.2 (receive ≤ 2 MiB → validate → R2 → insert row; on
  insert failure delete the object or queue cleanup with reason `upload_rollback`). Test with fakes for the repository and storage.
- Delete: Database Design §7.3 (one transaction: tombstone, unlink applications, clear
  text, queue cleanup); then the cleanup worker deletes from R2 with retries.
- Reconciliation pass for R2 objects with no DB row (crash between R2 write and insert): deferred, do last.
- Don't add a hardcoded test user or an in-memory repository as a fallback.

### 3. Agree with teammates (small interface examples are enough)
- **Zishi:** how the verified `userId` reaches handlers; auth checked before reading the
  upload body; CSRF/origin protection for file routes; resume linking goes through the
  application update.
- **Rongxin:** agreed 2026-11-17, see Database Design Appendix C.4. I own the cleanup worker.
- **Justin:** HTTP status for each error code; upload warning and "AI can't read" badge;
  PDF preview via Blob URL. Tell him: resume list gains `linkedApplicationCount` and loses
  pagination (endpoints 1.10.0); a 404 on a retried DELETE means the resume is already gone.

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
