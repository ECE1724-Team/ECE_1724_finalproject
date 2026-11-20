# Jianye's Dev Plan and Progress Log

Owner: Jianye Zhou. Areas: resume storage (Cloudflare R2), PDF parsing, resume API, AI Copilot.
This is my own record. Shared rules live in [backend/README.md](../backend/README.md) (setup,
errors, limits, known gaps), [PRD §5.2](PRD.md) (file rules),
[Database Design §5.11, §7.2–7.3, C.4](Database_Design.md) (cleanup, upload/delete, repository
contract), [AI Design](AI_Design.md) and [endpoints.json](endpoints.json).

## Status (2026-11-19)

| Area | State |
|---|---|
| Resume backend | Done. Phase 4 Stages 1–2 passed, including live R2. |
| Browser check | Pending (target Nov 25): needs application API [PR #11](https://github.com/ECE1724-Team/ECE_1724_finalproject/pull/11) reviewed and the resume dialog connected; the frontend still uses mocks. |
| AI Copilot | Phases 1–3 done: workspace API, material snapshots, streaming replies with retry and recovery; live check passed (≈ US$0.0002). Phase 4 next. |

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

Jianye owns the AI frontend, backend, HTTP endpoints, routes, SQL, any required migrations, and acceptance testing. A user can select an application, get advice based on its current resume and job description (JD), practice an interview, and return to the same conversation later. **This release includes a sliding history window and context compression.** Web search, company website reading, and their function calls are deferred. The company website URL is available as a saved application field.

Use the existing Express, PostgreSQL, and Vercel AI SDK design. The two AI migrations already define workspaces, conversations, messages, generation runs, material snapshots, and summaries. A single backend instance can run one generation per conversation while other conversations proceed independently. Get one complete turn working first, add compression, then connect the browser. [Database Design §§5.6–5.10 and 7.4](Database_Design.md) · [AI Design](AI_Design.md) · [HTTP and SSE contract](endpoints.json)

### Model, budget, and initial settings

- Use `gpt-6-luna` for both replies and internal summaries. An ordinary turn makes one model call. A turn that needs compression makes one additional call. Inject a fake model during development and CI. Reserve live calls for a few integration checks, the rehearsal, and the demo. [Model details and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
- **The total budget for live testing and the demo is US$5.** Set aside US$2 for the demo. Before each live test session, check project usage and estimate the cost from the input and output caps at the current rates. Stop if the estimate exceeds the remaining budget. Use fictional resumes, record the model and token usage separately for replies and summaries, and keep credentials, resume text, and chat content out of logs.
- Start with a project limit of 128,000 input tokens per model request, 4,000 output tokens per reply (raised from 2,000 on 2026-11-19: a Chinese question set with answers hit 2,000), and 800 output tokens per internal summary. Count the entire request, including system instructions and materials, with a compatible tokenizer or a conservative upper bound. Cancel the call if the stream makes no progress for 30 seconds or the turn reaches 120 seconds, and expose the resulting state so the client can recover. Calibrate the window and compression thresholds with fixtures in Phase 4.

### 2026-11-19: Phase 1 · Open a workspace from an application (done)

Built: [`ai/routes.ts`](../backend/src/modules/ai/routes.ts) with the seven Phase 1 operations
(`listAiApplications`, `ensureAiWorkspace`, `getAiWorkspace`, list/create conversations,
`getAiConversation`, `listAiMessages`), mounted on the business router in `server.ts` for every
environment (no R2 or model settings needed). SQL lives in
[`workspaces/postgres-repository.ts`](../backend/src/modules/ai/workspaces/postgres-repository.ts) and
[`conversations/postgres-repository.ts`](../backend/src/modules/ai/conversations/postgres-repository.ts);
every query scopes by conversation → workspace → application → user from the session.
- Position search reuses the application repository's `list` (literal `ILIKE`, newest first) and maps
  `positionTitle` to `jobTitle`. A bad `status` or a repeated `q` is 400 `BAD_REQUEST`.
- PUT workspace is `INSERT … ON CONFLICT (application_id) DO NOTHING` then a read, so repeats and
  races return the same row with 200. Conversations are created only by POST (201, `title: null`).
- The workspace's `materials` come from the same reader as turn preparation (Phase 2);
  `linkedResume` lists any live linked resume, including a text-unavailable one, whose state shows
  in `materials.resume`. No text is returned.
- `materialState` is the baseline (§8.4), computed for a whole list in one query; messages come
  back in numeric `sequence_no` order as decimal strings.
- Missing, malformed and other users' IDs are 404. A database outage on these routes is 503
  `AI_SERVICE_UNAVAILABLE` (endpoints.json), not the shared `SERVICE_UNAVAILABLE`.

Tests: [`ai-workspace.db.test.ts`](../backend/tests/integration/ai-workspace.db.test.ts) over real HTTP,
sessions and PostgreSQL: 401/403/404 (another user, malformed ID); search + status filters
together, `%` as a literal, empty results; the same workspace twice; two conversations with their
own histories in order 2, 9, 10; and zero generations, snapshots, messages and summaries after
browsing, entering and creating conversations.

### 2026-11-19: Phase 2 · Fix the materials for each turn and assemble the model input (done)

Built:
- [`context/materials.ts`](../backend/src/modules/ai/context/materials.ts): the registry of six kinds
  (`resume`, `jd`, `company`, `position`, `company_website_url`, `company_notes`), one reader
  query (personal notes are not selected), and fingerprints `v1:` + SHA-256 of
  `JSON.stringify([kind, availability, reasonCode, sourceResumeId, contentText])`.
  Absence reasons: `RESUME_NOT_LINKED`, `RESUME_TEXT_UNAVAILABLE` (keeps the resume ID and name),
  `FIELD_MISSING` (null or blank). `changedKinds` includes kinds the baseline lacks, so a first
  turn reports all six.
- [`context/prompt.ts`](../backend/src/modules/ai/context/prompt.ts): system rules, then
  `<materials>` (XML-escaped text, `version` = resume name or the first 8 hex of the fingerprint),
  then `<material_changes>` only when a baseline exists and differs, then history, then the input
  once. Replies whose materials differ from the current ones get `[based on earlier materials: …]`.
- [`generations/postgres-repository.ts`](../backend/src/modules/ai/generations/postgres-repository.ts):
  `acceptInput` (conversation lock, active-run check → `GENERATION_ACTIVE` with nothing saved,
  sequence allocation, title from the first sentence up to 80 characters) and `prepareMaterials`
  (REPEATABLE READ; conversation then run lock; reuse a snapshot by `(conversation, kind,
  fingerprint)` or insert one; one `generation_materials` row per kind; baseline ID;
  `streaming`). `loadHistory` sends only completed turns; an input that never got an answer stays
  in the chat record but not in the prompt. `completeGeneration` and `endGeneration` were added
  early so tests can advance or skip the baseline; Phase 3 uses them as they are.
- [`generations/service.ts`](../backend/src/modules/ai/generations/service.ts) `prepareTurn`: on a
  preparation error it records `MATERIAL_REFRESH_FAILED` in a separate transaction and rethrows, so
  the caller never reaches the model. Phase 3 added the model call in the same file.
- `getSnapshot` (conversation repository) reads a snapshot only through its own conversation;
  Phase 3 added its HTTP route.

Tests: [`ai-context.test.ts`](../backend/tests/unit/ai-context.test.ts) checks the exact roles and
text of first-turn and V1→V2 requests, escaping, notices for unlinked/scanned/removed materials and
fingerprint rules. [`ai-materials.db.test.ts`](../backend/tests/integration/ai-materials.db.test.ts)
covers an edit reverted before the next turn (same snapshots), two resumes with identical text,
missing JD and scanned resume as distinct absences, unlink, relink reusing V1's snapshot, deletion
with V1 text still readable only through its conversation, a switch during generation (that turn
keeps V1, the next sees V2), independent refresh of two conversations, a failed attempt repeating
the notice and reusing its snapshot, a concurrent send rejected without saving input, and injected
snapshot-write and material-read failures (run `failed`/`MATERIAL_REFRESH_FAILED`, input kept,
no snapshots, zero model calls). Workspace and preparation fingerprints match.

Results at the end of Phase 2 (Node 26.8.2, PostgreSQL 18.6): typecheck, `npm test` (104),
`npm run test:db` (170, run with `TEST_DATABASE_URL` on a local loopback server) and build all
pass. No live model calls.

### 2026-11-19: Phase 3 · Stream and save replies, then handle disconnects and retries (done)

Built:
- [`integrations/llm/openai.ts`](../backend/src/integrations/llm/openai.ts) on `ai@7.0.162` and
  `@ai-sdk/openai@4.0.108` (pinned; latest releases at least two weeks old). Requests carry no tools,
  have 4,000 output tokens (was 2,000) and stop after 30 s without text or 120 s in all. The SDK's default
  `onError` is switched off because it logs the request body; our logs record only the error type.
- `OPENAI_API_KEY` and `AI_MODEL` (default `gpt-6-luna`) in `env.ts` and `.env.example`. Without a
  key the server warns, reads work and a send or retry answers 503 `AI_SERVICE_UNAVAILABLE` without
  saving input.
- Routes for send, retry, list/read generations and read a snapshot (without `sourceLabel`, which
  is not in `AiMaterialSnapshot`). The body must be exactly `{ content }` with non-blank text.
  JSON errors before the stream opens (400, 404, 409 `GENERATION_ACTIVE` / `RETRY_CONFLICT`, 503);
  after it, SSE events in contract order with `Cache-Control: no-store`.
- [`generations/service.ts`](../backend/src/modules/ai/generations/service.ts) `runTurn`: prepare →
  `materials.synced` → stream deltas → save the reply and complete the run in one transaction →
  `generation.completed`. Each failure ends the run and sends `generation.error` with its stage:
  preparation `MATERIAL_REFRESH_FAILED`, context or model `GENERATION_FAILED` (timeouts too), client
  gone `GENERATION_INTERRUPTED`, save failure `MESSAGE_PERSISTENCE_FAILED`. An uncertain commit is
  checked by run ID first. Partial text is never saved.
- `acceptRetry` checks eligibility under the conversation lock (latest user message, its most
  recent attempt, `failed`/`interrupted`) and adds a new attempt on the same input. `server.ts` runs
  `recoverAbandonedGenerations` before listening. `generation_runs.model_metadata` stores provider,
  model, input/output tokens and finish reason.

Tests: [`fakes/llm.ts`](../backend/tests/fakes/llm.ts) is a `MockLanguageModelV4` the test can feed,
fail or finish, driven through the real adapter. [`ai-generation.db.test.ts`](../backend/tests/integration/ai-generation.db.test.ts)
(real HTTP, SSE, PostgreSQL) covers event order, no saved deltas, recovery of a missed completion
from reads, 409 without saving input, two conversations at once, the deletion guard, failure then
retry (one user message, failed attempt kept, `RETRY_CONFLICT` for ineligible attempts),
preparation failure with no model call, client disconnect (interrupted, nothing saved), restart
recovery and the no-key 503. [`llm.test.ts`](../backend/tests/unit/llm.test.ts) covers usage,
model error, abort and both timeouts.

Results (Node 26.8.2, PostgreSQL 18.6): typecheck, `npm test` (106), `npm run test:db` (176, with
`TEST_DATABASE_URL` on a local loopback server) and build pass.

Live check, `gpt-6-luna` through `runTurn` and a temporary database, fictional resume, two turns:
| Turn | Input tokens | Output tokens | First text / total | Result |
|---|---|---|---|---|
| Ask one behavioral question | 522 | 22 | 1.8 s / 2.3 s | One on-call question |
| Answer, ask for feedback | 574 | 103 | 1.5 s / 2.3 s | Feedback plus a follow-up that noted the answer did not address the on-call question |

Both completed (`stop`), 4 messages saved in order. Cost ≈ US$0.0002 at $0.10 / $0.50 per 1M
input/output tokens; reasoning tokens did not crowd out the reply at the default effort.

### Phase 4 · Add a sliding window and incremental history summaries

**Implementation.** Put history selection, token budgeting, and compression triggers in `context/history.ts`. Read and write `conversation_summaries` in `conversations/postgres-repository.ts`, add a summary call to the model adapter, and pass the result to `context/prompt.ts` and `generations/service.ts`. Generate the summary during the turn that needs it.

1. Count one completed question and answer as one turn. Start compression when unsummarized completed turns reach **64,000 tokens**, or sooner if the full answer request would exceed the project input limit. Turn count alone never triggers compression. Keep the newest complete turns verbatim up to a target of **16,000 history tokens** and summarize the older prefix. Reduce that window by complete turns if the full request still exceeds the limit. Keep the current input separate and reuse it on retry. Older inputs that never received a complete answer remain visible in the chat record.
2. Give the summarizer the previous summary, the newly covered complete turns, and the material versions behind each answer. Ask it to retain experiences already discussed, interview progress, and open follow-up questions. Label version-specific points, for example “based on resume V1.” After the model returns, validate the previous summary and the new coverage boundary in a short transaction before saving `through_sequence_no`. Include only turns after that boundary alongside the summary. Keep the full original messages in the database.
3. Include all six current materials in every answer request, independently of the window and summary. If compression fails, keep the last valid summary. Generate the reply if all history after its boundary still fits. Otherwise report the failure and allow retry. If the materials and current input alone exceed the budget, return `CONTEXT_CAPACITY_EXCEEDED` and identify what to shorten. If history is the cause, suggest a new conversation. Apply the input budget to the summary request itself and report a capacity error if it cannot fit in a single call.

**Tests and acceptance.** Use small thresholds in `backend/tests/unit/ai-history.test.ts` to trigger compression predictably. Verify stored boundaries in `backend/tests/integration/ai-history.db.test.ts`. Twenty short turns below both token limits must make zero summary calls. Use a lower token threshold for the seeded demo. Crossing the threshold adds one summary call. Each incremental summary incorporates its predecessor, and each completed turn appears exactly once across the summarized prefix and verbatim window. A failed summary must leave the coverage boundary intact. Switching conversations must select only that conversation's summary. Run one live compression check on seeded fictional history. Compare the summary with the original questions, pending follow-ups, and V1 references. After switching to V2, verify that the interview continues naturally, current resume advice uses V2, and the full original history is readable after reload.

### Phase 5 · Build the frontend and verify the demo (not now)

Use the existing `/interview` entry point, `routes/`, `components/`, `lib/`, and shared `types.ts`. Create the frontend files in this final phase as shown below.

```text
frontend/src/
  main.tsx                            Register /interview and its workspace and conversation routes
  routes/Interview.tsx                Replace the placeholder with position search, status filters, and empty states
  routes/InterviewWorkspace.tsx       Display the workspace and restore the selected conversation on reload
  components/ai/ConversationList.tsx  Create and select conversations, show titles and recent conversations
  components/ai/ChatPanel.tsx         Display messages, input, shortcuts, sync status, retries, and historical materials
  lib/ai.ts                           Call workspace and history APIs, send POST with cookies, adapt SSE events
  types.ts                            Reuse Ai* types and align the snapshot detail id with OpenAPI
```

**Implementation and interaction.** Reuse the existing navigation and UI components. Connect `@ai-sdk/react` through the project's SSE adapter, and update `frontend/package.json` and its lockfile. The standalone entry lists real applications. Selecting one creates or reuses its workspace, where the user can continue a conversation or choose “New conversation” in an empty workspace. Wire the application-detail entry through `routes/Application.tsx` and `components/ApplicationForm.tsx`. Save pending edits before opening the workspace and stay on the detail page if saving fails. While the application form still uses mocks, exercise the standalone entry against the real backend with test applications.

Show the company, position, linked resume, and resume text availability in the chat view. Shortcuts prefill editable input. Disable sending while a generation is active. If the stream closes before a terminal event arrives, read the durable status and either restore the saved reply or show the interruption and retry action. Let users expand old replies to inspect the materials they used. Display conversation titles derived from the first input. The first release supports creating, switching, and resuming conversations. Renaming, individual deletion, and pagination are deferred.

**Tests and acceptance.** Run `npm run typecheck`, `npm test`, `npm run test:db`, and `npm run build` in the backend. Run `npm run build` and `npm run lint` in the frontend. Exercise both entries in Chrome and Edge with verified accounts, real session cookies, and fictional materials. For the demo, select a position, start a conversation, request resume advice, practice one interview question at a time, switch to V2, and continue. Reload and inspect the materials behind an earlier reply. Use seeded turns to demonstrate one compression. Also verify the scanned-resume notice, isolation between two accounts, and retry after a disconnect. Record the date, test results, model usage, and open issues here before updating the status table.
