# Jianye's Dev Plan and Progress Log

Owner: Jianye Zhou. Areas: resume storage (Cloudflare R2), PDF parsing, resume API, AI Copilot.
This is my own record. Shared rules live in [backend/README.md](../backend/README.md) (setup,
errors, limits, known gaps), [PRD §5.2](PRD.md) (file rules),
[Database Design §5.11, §7.2–7.3, C.4](Database_Design.md) (cleanup, upload/delete, repository
contract), [AI Design](AI_Design.md) and [endpoints.json](endpoints.json).

## Status (2026-11-21)

| Area | State |
|---|---|
| Resume backend | Done. Phase 4 Stages 1–2 passed, including live R2. |
| Browser check | Pending (target Nov 25). The application API is merged and the frontend now calls the resume and application APIs; some pages still import test data. |
| AI Copilot | Backend Phases 1–4 done ([PR #15](https://github.com/ECE1724-Team/ECE_1724_finalproject/pull/15)); live checks passed (≈ US$0.0012). Phase 5 (frontend) next. |

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
- **Budget for live tests and the demo: US$5, with US$2 kept for the demo.** Spent so far ≈ US$0.0012.
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

### Phase 5 · Build the frontend and verify the demo (in progress)

**2026-11-21: skeleton.** The files below exist and `npm run build` and `npm run lint` pass. The
pages are placeholders with `TODO(Phase 5)` notes; `lib/ai.ts` already has the JSON calls, while
`streamGeneration` is still a stub. It follows the current frontend's conventions: one CSS module
per page or component in `styles/`, `fetch` with `credentials: "include"` and `responseError`.

```text
frontend/src/
  main.tsx                            /interview and /interview/:workspaceId/:conversationId?
  routes/Interview.tsx                Position search, status filter, empty states
  routes/InterviewWorkspace.tsx       Workspace header (company, position, resume and its text status)
  components/ai/ConversationList.tsx  Create and switch conversations; titles from the first message
  components/ai/ChatPanel.tsx         Messages, input, shortcuts, sync status, retry, materials of old replies
  lib/ai.ts                           API calls and the SSE reader for send and retry
  styles/Interview.module.css, InterviewWorkspace.module.css, ConversationList.module.css, ChatPanel.module.css
  types.ts                            AiMaterialSnapshot fixed: it has `id`, not `snapshotId`
```

Changes from the earlier plan: no `@ai-sdk/react`. Its `useChat` expects the AI SDK's own stream
protocol, our events are the custom ones in endpoints.json, and `EventSource` cannot send a POST, so
`lib/ai.ts` reads the response body itself. The application form already uses the real API, so no
mock workaround is needed.

**Behavior.** Selecting an application opens (or creates) its workspace. The conversation ID stays
in the URL, so a reload restores it. Shortcuts prefill editable input. Sending is disabled while a
generation is active. If the stream ends without a terminal event, read the generation to restore
the saved reply or offer a retry. Old replies can be expanded to show the materials they used. On a
compressing turn, `materials.synced` arrives about 5 s late. Renaming, deleting and pagination of
conversations are deferred. The entry from the application detail page comes last: it saves pending
edits first and stays on the page if saving fails.

**Acceptance.** Backend: `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build`.
Frontend: `npm run build`, `npm run lint`. In Chrome and Edge, with verified accounts and fictional
materials: pick a position, ask for resume advice, practice one question at a time, switch to V2 and
continue, reload and inspect an earlier reply's materials, show one compression on seeded turns, and
check the scanned-resume notice, isolation between two accounts, and retry after a disconnect.
Record the date, results, model usage and open issues here.
