# Jianye's Dev Plan and Progress Log

Owner: Jianye Zhou. Areas: resume storage (Cloudflare R2), PDF parsing, resume API, AI Copilot.
This is my own record. Shared rules live in [backend/README.md](../backend/README.md) (setup,
errors, limits, known gaps), [PRD §5.2](PRD.md) (file rules),
[Database Design §5.11, §7.2–7.3, C.4](Database_Design.md) (cleanup, upload/delete, repository
contract), [AI Design](AI_Design.md) and [endpoints.json](endpoints.json).

## Status (2026-11-23)

| Area | State |
|---|---|
| Resume backend | Done. Phase 4 Stages 1–2 passed, including live R2. |
| Browser check | Pending (target Nov 25). The application API is merged and the frontend now calls the resume and application APIs; some pages still import test data. |
| AI Copilot | Backend Phases 1–4 done ([PR #15](https://github.com/ECE1724-Team/ECE_1724_finalproject/pull/15)). Phase 5 (frontend) done and checked end to end in the app's Chromium browser with the live model (≈ US$0.005 spent in all). Edge and the team check remain. |

## Progress log

### 2026-11-15 → 11-17: Phases 1–4 (modules)
- R2 adapter (`putNew`/`read`/`head`/`delete`, writes never overwrite); PDF.js in a killable
  worker thread, max 2 at a time. Scanned PDFs are stored as `text_unavailable` instead of rejected.
- Resume service, routes and cleanup worker are mine; Rongxin wrote the SQL behind my
  `repository.ts` interfaces (Database Design C.4).
- Lessons: multer needs `defParamCharset: "utf8"` (Chinese file names); detect PostgreSQL
  errors with `instanceof DatabaseError` (a socket `EPIPE` looked like a SQLSTATE).

<a id="phase-4-stage-1"></a>

### 2026-11-19: Phase 4 Stage 1 (server wiring, local)
Routes mounted on the shared business router behind Origin and verified-session checks; one
worker starts after listen and stops before its dependencies close. Blank R2 in development
skips the module with one warning. DB tests cover all five routes, auth cases, the exact 2 MiB
boundary, password/99+1/scan fixtures and storage outages
([HTTP test](../backend/tests/integration/resume-http.db.test.ts),
[recovery tests](../backend/tests/integration/resume-workflow.db.test.ts)).

<a id="phase-4-stage-2"></a>

### 2026-11-19: Phase 4 Stage 2 (live R2)
Node 26.8.2, PostgreSQL 18.6: typecheck, `npm test` (102), `npm run test:db` (164), build and
`R2_INTEGRATION_TEST=1 npm run test:r2` (1 passed, not skipped). Through `npm start` with real R2:
4 uploads → list/metadata/byte-identical download → 4 deletes → 404 at once → jobs `done` →
objects gone (HEAD) → SIGTERM exit 0. The V1/V2 link workflow against the PostgreSQL
application repository also passed.

| Sample | Result | Text order |
|---|---|---|
| [Word via Distiller](https://disability.mo.gov/gcd/files/sample_resume.pdf) | available (1,078) | Readable |
| [Two-column LaTeX](../backend/tests/fixtures/resume-samples/latex-two-column.pdf) | available (479) | Name, left column, right column |
| [Canva](https://cdn2.f-cdn.com/files/download/200475984/White%20Simple%20Student%20CV%20Resume.pdf) | available (513) | Spaced headings split into letters; some sections out of order |
| [Raster scan](../backend/tests/fixtures/resume-samples/raster-scan.pdf) | unavailable, `extracted_text IS NULL` | — |

## Next: team browser check (Chrome and Edge, mocks off)
- [ ] Upload via the dialog, reload, preview/download, check link counts; the scan shows the
  text-unavailable warning on upload and on selection.
- [ ] Link V1 to two applications; an invalid replacement keeps both on V1; switch one to V2
  with the full PUT payload; restore both, see count 2, delete V1: both links removed, both applications kept.
- [ ] AI Prep in Edge with real uploads and verified accounts: repeat the
  [Phase 5 checks](#phase-5) (already passed in Chromium on seeded data).

## Don't undo these
Worker-thread isolation and the `busy` limit; `If-None-Match` on writes; never accepting a
storage key or user ID from the browser; no text in `unavailable` results; R2 objects of
deleted resumes are removed only by the cleanup worker after the DB commit; auth before
reading the upload body; finishing the insert after the R2 write even if the client left;
retaining the object while an insert outcome is unclear; the worker's live-resume check.

## AI Copilot development plan

Jianye owns the AI frontend, backend, routes, SQL, migrations and acceptance testing. A user picks
an application, gets advice based on its current resume and job description (JD), practices an
interview and returns to the same conversation later; long histories are windowed and summarized.
Web search and company website reading are deferred (the website URL is only a saved field).
Routes, errors and limits: [backend README → AI Copilot](../backend/README.md#ai-copilot). Design:
[AI Design](AI_Design.md), [Database Design §5.6–5.10, §7.4](Database_Design.md),
[endpoints.json](endpoints.json).

### Model and budget

- `gpt-6-luna` for replies and summaries ([model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)):
  one call per turn, plus one when history is compressed. Development and CI use a fake model.
- **Budget for live tests and the demo: US$5, with US$2 kept for the demo.** Spent so far ≈ US$0.005.
  Before each live session, check project usage and estimate the cost from the input and output
  caps; stop if it exceeds what is left. Use fictional resumes. Keep credentials, resume text and
  chat content out of logs.
- Caps: 128,000 estimated input tokens per request, 4,000 output tokens per reply (raised from
  2,000 after a Chinese question set hit it), 800 per summary. Each model call stops after 30 s
  without text or 120 s in all, so a compressing turn can take up to about 240 s.

### 2026-11-19 → 11-21: Phases 1–4 (backend, done)

- **1 · Workspaces and conversations.** Seven read/create routes. Every query checks ownership
  through conversation → workspace → application → user; browsing and creating conversations write
  no messages, snapshots or generations. [Tests](../backend/tests/integration/ai-workspace.db.test.ts)
- **2 · Materials and prompt.** Six material kinds are read on every turn, fingerprinted and
  snapshotted per conversation (a reverted edit reuses its snapshot). The prompt adds a change
  notice and tags replies based on old versions. A preparation failure is recorded and makes no
  model call. [Unit](../backend/tests/unit/ai-context.test.ts) · [DB](../backend/tests/integration/ai-materials.db.test.ts)
- **3 · Streaming, disconnects and retries.** SSE send and retry. The reply is saved in the same
  transaction that completes the run; partial text never is. A disconnect marks the run
  interrupted, and startup does the same for runs left over by a crash.
  [DB](../backend/tests/integration/ai-generation.db.test.ts) · [Adapter](../backend/tests/unit/llm.test.ts)
- **4 · Sliding window and summaries.** Values in [AI Design §4.3](AI_Design.md). Each summary
  extends the previous one and is saved only if its boundary is still valid; a failed summary keeps
  the last one. With small thresholds the tests check: no summary over twenty short turns, every
  turn covered exactly once, V1 tags after a switch to V2, one summary per conversation, and
  failure then retry. [Unit](../backend/tests/unit/ai-history.test.ts) · [DB](../backend/tests/integration/ai-history.db.test.ts)

After merging `main` (2026-11-21): typecheck, `npm test` (125), `npm run test:db` (208) and build pass.

Live checks (`gpt-6-luna`, fictional data, temporary database):

| Date | Check | Tokens in / out | Result |
|---|---|---|---|
| 11-19 | Two mock-interview turns | 1,096 / 125 | One question at a time; the feedback noticed an off-topic answer |
| 11-20 | Six seeded turns, switch to V2, two live turns (compress at 600, window 250) | 4,836 / 1,129, of which the summary 989 / 518 | The summary kept answers, the unanswered question, open items and V1-tagged advice; replies used V2 and continued the interview |

Open issues:
- A turn that summarizes and then fails keeps the summary but not its token usage.
- Database Design §12 still lists a requester review of the context-sizing values.

Don't undo these: the SDK's `onError` is silenced because its default logs the prompt; partial
replies are never saved; current materials are sent in full every turn and never summarized; a
summary is saved in its own short transaction only if its predecessor and boundary are unchanged.

<a id="phase-5"></a>

### 2026-11-21 → 11-23: Phase 5 (frontend, done)

**11-21: skeleton** of the files below, following the frontend's conventions (one CSS module per
page or component in `styles/`, `fetch` with `credentials: "include"` and `responseError`). No
`@ai-sdk/react`: its `useChat` expects the AI SDK's own stream protocol, our events are the custom
ones in endpoints.json, and `EventSource` cannot POST, so `lib/ai.ts` reads the response body itself.

**11-23: implemented.**

```text
frontend/src/
  routes/Interview.tsx                Position picker: search (debounced), status filter, empty states;
                                      ?application=<id> opens that workspace directly
  routes/InterviewWorkspace.tsx       Header (title + edit, company + material chips), scanned-resume warning;
                                      restores the latest conversation
  components/ai/ConversationList.tsx  New conversation, list, inline rename (pencil; Enter saves, Escape cancels)
  components/ai/ChatPanel.tsx         Messages (Markdown), shortcuts, streaming, Stop, Retry, materials of each reply
  lib/ai.ts                           API calls, SSE reader, material labels
  components/ApplicationForm.tsx      "AI Interview Assistant" on the detail page (view mode only)
```

- **Entry.** The picker and the detail page both call `PUT …/ai-workspace` and open
  `/interview/:workspaceId`; neither creates a conversation. Without a conversation ID the workspace
  opens its most recent conversation, or shows "New conversation" when it has none. The detail-page
  button only appears while viewing, so there are never unsaved edits to save first; the AI reads
  the saved application.
- **Turns.** Shortcuts only fill the input (FR-25). Enter sends, Shift+Enter adds a line, and Enter
  while an input method is composing (Chinese) does not send. Send is disabled while any attempt is
  active. Status lines follow the events: "Sending…", "Reading your materials…" until
  `materials.synced` (about 5 s on a compressing turn), then "Writing a reply…".
- **One reconcile path instead of `getGeneration`.** After every stream end (completed, error, Stop,
  network loss, 409/503) the panel rereads conversation, messages and attempts and renders from
  them: the saved reply, Retry for the latest message's failed or interrupted attempt, or "still in
  progress", which polls every 2 s (the server marks a stopped run interrupted a moment later, and
  another tab may be answering). Partial text stays visible, marked "not saved", until reload (FR-29).
  A rejected send keeps the draft. Leaving the conversation aborts its stream, so the run becomes
  interrupted and can be retried.
- **Materials.** "Updated before this reply: Resume" comes from the attempt's `changedKinds` when
  it has a baseline (the first answer has none). "Based on earlier materials: …" compares each
  reply's fingerprints with the workspace's current ones. "Materials used for this reply" loads the
  snapshots on first open. The snapshot API deliberately omits `sourceLabel` (a DB test asserts it),
  so a resume is named only when it is the one linked now, otherwise "an earlier resume".
- **Markdown** replies (the prompt asks for headings and lists) use `react-markdown` + `remark-gfm`,
  lazy-loaded so the main bundle stays under Vite's 500 kB warning (489 kB; about 165 kB in separate chunks).
  Links open in a new tab; raw HTML is not rendered.
- **Header and rename (11-23, after review).** No explanatory hint under the header; a missing
  material is a grey ✕ chip with the reason only as a tooltip (also in "Materials used"). Title and
  "Edit application" share a row, company and chips the next, so the warning no longer stacks below
  them. Conversations can be renamed through the new `PATCH /ai/conversations/{id}` (trimmed, 1–80
  characters, no change to `updatedAt` or order; DB test in `ai-workspace.db.test.ts`); workspaces
  keep company and position as their name.
- **AI Copilot page (11-26, team agreed).** Renamed from "AI Interview Prep" (nav too). It lists
  only applications that have a workspace; "New workspace" picks one of the others (search and
  status filter) and creates its workspace. `GET /ai/applications` now returns each application's
  `workspaceId` (null if none). `npm run seed` (backend README) fills a development database with
  the demo account, 15 applications (the three AI ones listed first) and the three workspaces:
  full materials, no resume, and an image-only resume.
- **Fixed in passing:** `dark:` utilities do not work inside CSS Modules, which rename `.dark` in
  the variant's selector. `ErrorAlert.module.css` (light red box in dark mode) and the workspace
  warning now use `:global(.dark) .class`.

**Acceptance (11-23).** Backend: typecheck, `npm test` (125), `npm run test:db` (208), build: all
pass. `test:db` ran with `TEST_DATABASE_URL` on the local PostgreSQL 18 server because the sandbox
could not start the throwaway cluster. Frontend: `npm run build` passes, `npm run lint` adds no
warnings. Browser: the desktop app's Chromium pane, a scratch database seeded with fictional
accounts, applications and resumes (no R2 upload, no email), `gpt-6-luna`.

| Check | Result |
|---|---|
| Picker | Only the user's applications; case-insensitive search; no-match and no-applications states, the latter with "New Application" |
| Scanned resume, no JD | Chips show "Text could not be read" / "Not provided" plus a warning; the Chinese reply said the resume cannot be read and gave limited help |
| Resume advice | Streamed as Markdown, saved; the conversation took its title from the first message |
| V1 → V2 | Switched on the detail page, re-entered through "AI Interview Assistant": same workspace, latest conversation restored; the old reply is tagged "Based on earlier materials: Resume" and its materials show V1's text |
| Mock interview | Edited shortcut sent as typed; "Updated before this reply: Resume"; one question at a time; feedback used V2's metrics |
| Stop and retry | Stop before text and after text: interruption notice + Retry (partial marked not saved); after reload only the notice; Retry reused the input; DB: interrupted runs have no reply, no duplicate input |
| Compression | Backend restarted with 600 / 250: "Reading your materials…" during the summary, summary saved through message 8, reply input 1,855 tokens |
| Isolation | Second account: its own application only; the first account's workspace URL shows 404, and its conversation, messages, workspace PUT and send all answer 404 |
| Layout | Light and dark; 375 px wide; no console errors except the deliberate 404 probes |

Model usage: completed turns 11,278 in / 2,825 out, plus the summary 2,071 / 793; two interrupted
attempts record none. About US$0.004 at the rate of the 11-19/20 checks.

Open issues:
- Edge, real uploads and email verification are not covered by this check (see the team check above).
- Leaving a conversation mid-reply interrupts it without a warning; Retry recovers it.
- Deleting and paginating conversations remain deferred; the Dashboard has no per-position
  AI entry (FR-10 is met by the detail page).
- `npm run test:db` needs `TEST_DATABASE_URL` where creating a local cluster is not allowed.
