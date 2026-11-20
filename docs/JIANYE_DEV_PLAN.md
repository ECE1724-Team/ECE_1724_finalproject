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
| AI Copilot | Scope agreed. Implementation will follow the five phases below. |

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
- Start with a project limit of 128,000 input tokens per model request, 2,000 output tokens per reply, and 800 output tokens per internal summary. Count the entire request, including system instructions and materials, with a compatible tokenizer or a conservative upper bound. Cancel the call if the stream makes no progress for 30 seconds or the turn reaches 120 seconds, and expose the resulting state so the client can recover. Calibrate the window and compression thresholds with fixtures in Phase 4.

### Phase 1 · Open a workspace from an application

**Implementation.** Define the shared AI router in `backend/src/modules/ai/routes.ts`. Implement workspace and conversation reads and writes in `workspaces/postgres-repository.ts` and `conversations/postgres-repository.ts`. These module paths are relative to `backend/src/modules/ai/`. Mount the router on the existing protected business router in `backend/src/server.ts`. Reuse the application repository's search and six status values for the position selector. Map `positionTitle` to the API's `jobTitle` and take the user identity from the verified session.

**Endpoints.** List the user's applications, create or reuse an application's workspace with PUT, read the workspace, list or create conversations, and read a conversation and its messages. The workspace exposes material metadata using the same material reader that Phase 2 uses to prepare a generation. Create a conversation only when the user chooses “New conversation.” Its initial title is `null`. Return messages in ascending numeric `sequenceNo` order and encode that value as a decimal string in the API.

**Tests and acceptance.** Add `backend/tests/integration/ai-workspace.db.test.ts` using the verified-account and application fixtures. Check that search and status filters work together on the user's applications, including an empty result. Opening an application twice must return the same workspace, and two conversations must retain independent histories. Expect 401 for anonymous access, 403 for an unverified account, and 404 for another user's resource. Browsing positions, entering a workspace, and creating an empty conversation must produce zero generations, material snapshots, or model calls. Once the Phase 2 reader is available, verify that the workspace and generation paths produce the same fingerprints for the same materials.

### Phase 2 · Fix the materials for each turn and assemble the model input

**Implementation.** Define the six material kinds, source fields, version labels, and reasons for missing content in `context/materials.ts`. Assemble the request in `context/prompt.ts`. In `generations/postgres-repository.ts`, use the existing pool and `withTransaction` for two short transactions. The first locks the conversation and saves the user message and its `preparing` attempt. Derive the title from the opening sentence of the first accepted message. The second reads the current application, linked resume, and materials behind the most recent completed reply from one consistent database snapshot.

- Load the resume, JD, company, position, company website URL, and company notes. Read saved resume text from PostgreSQL and exclude personal notes from the prompt. Record a missing resume link, a linked resume marked `text_unavailable`, and a missing JD as distinct cases. Chat can continue with the available materials. If a database read or snapshot write fails, roll back preparation, record `MATERIAL_REFRESH_FAILED`, and retain the accepted input for retry.
- Serialize the kind, availability, reason, source ID, and exact text in a stable order. Prefix the SHA-256 digest with `v1:`. Within each conversation, reuse snapshots with matching fingerprints. Link one snapshot per material kind to the generation and save the comparison baseline before entering `streaming`. Only a **completed** generation advances the baseline.
- Assemble behavior rules, fixed materials and version labels, any change notice, this conversation's history, and the current input in that order. Include the current input once. Annotate older replies that relied on superseded materials. Start reporting changes only after a baseline exists. The prompt treats materials as data, grounds advice in known facts, and explains limitations when information is missing. Support resume advice, HR, technical, and behavioral interviews, one-question-at-a-time follow-ups, and feedback. Save feedback as an ordinary reply.

**Tests and acceptance.** Inspect the exact roles and text sent to the model in `backend/tests/unit/ai-context.test.ts`, and inspect persisted snapshots in `backend/tests/integration/ai-materials.db.test.ts`. Cover switching from V1 to V2, two resume IDs with identical text, an edit reverted before the next turn, a missing JD, a scanned resume, unlinking or deletion, and an injected material-read failure. A resume switch during generation must affect only later turns. Each conversation must refresh on its own next turn. Historical snapshots must remain readable through their original conversation after resume deletion. A database failure during preparation must result in zero model calls.

### Phase 3 · Stream and save replies, then handle disconnects and retries

**Implementation.** Wrap SDK text streaming, cancellation, and usage reporting in `backend/src/integrations/llm/openai.ts`. Update `backend/package.json`, its lockfile, `backend/src/config/env.ts`, and `backend/.env.example`. Read credentials from the server environment. In development, workspace and history reads should work without model configuration, and a send should report that generation is unavailable. Coordinate preparation, the model call, and the final write in `generations/service.ts`. Extend the generation repository, shared router, and `server.ts` accordingly.

- Complete the OpenAPI operations for listing generations, reading an attempt, sending a message, retrying by generation ID, and reading a snapshot within its conversation. Accept only `{ content }` for a new send. Check both conversation membership and user ownership for generation and snapshot reads.
- Emit `generation.accepted` after the input commits, `materials.synced` after preparation commits, and `text.delta` as text arrives. In a final short transaction, save the complete reply and mark the run completed together. Emit `generation.completed` only after that commit. Return HTTP errors before streaming starts and use `generation.error` once the stream is open. If the commit outcome is uncertain, look up the generation by ID. Keep model waits and network writes outside database transactions.
- Use the existing conversation lock and unique index to return 409 for a concurrent send in the same conversation without saving a second input. When the stream breaks or the client disconnects, cancel the model call, mark the run interrupted, and discard partial output. Allow explicit retry only for the latest user message when its most recent attempt failed or was interrupted. Reuse the original input and reread current materials. Before the single instance starts listening, mark abandoned active runs interrupted so their conversations can accept input again.

**Tests and acceptance.** Add a text stream that can pause, fail, or finish on demand in `backend/tests/fakes/llm.ts`. In `backend/tests/integration/ai-generation.db.test.ts`, use real HTTP and PostgreSQL to check SSE ordering, database commits, disconnects, and restart recovery. Two conversations can generate at once. A concurrent send in the same conversation returns 409, and the existing deletion guard protects an application during generation. After a retry there is one original user message, and the failed attempt remains available for inspection. If the client misses the completion event, a status read must recover the saved reply. Finish with one live two-turn conversation using a fictional resume to verify streaming, follow-up, and persistence. Record the usage.

### Phase 4 · Add a sliding window and incremental history summaries

**Implementation.** Put history selection, token budgeting, and compression triggers in `context/history.ts`. Read and write `conversation_summaries` in `conversations/postgres-repository.ts`, add a summary call to the model adapter, and pass the result to `context/prompt.ts` and `generations/service.ts`. Generate the summary during the turn that needs it.

1. Count one completed question and answer as one turn. Start compression when unsummarized completed turns reach **64,000 tokens**, or sooner if the full answer request would exceed the project input limit. Turn count alone never triggers compression. Keep the newest complete turns verbatim up to a target of **16,000 history tokens** and summarize the older prefix. Reduce that window by complete turns if the full request still exceeds the limit. Keep the current input separate and reuse it on retry. Older inputs that never received a complete answer remain visible in the chat record.
2. Give the summarizer the previous summary, the newly covered complete turns, and the material versions behind each answer. Ask it to retain experiences already discussed, interview progress, and open follow-up questions. Label version-specific points, for example “based on resume V1.” After the model returns, validate the previous summary and the new coverage boundary in a short transaction before saving `through_sequence_no`. Include only turns after that boundary alongside the summary. Keep the full original messages in the database.
3. Include all six current materials in every answer request, independently of the window and summary. If compression fails, keep the last valid summary. Generate the reply if all history after its boundary still fits. Otherwise report the failure and allow retry. If the materials and current input alone exceed the budget, return `CONTEXT_CAPACITY_EXCEEDED` and identify what to shorten. If history is the cause, suggest a new conversation. Apply the input budget to the summary request itself and report a capacity error if it cannot fit in a single call.

**Tests and acceptance.** Use small thresholds in `backend/tests/unit/ai-history.test.ts` to trigger compression predictably. Verify stored boundaries in `backend/tests/integration/ai-history.db.test.ts`. Twenty short turns below both token limits must make zero summary calls. Use a lower token threshold for the seeded demo. Crossing the threshold adds one summary call. Each incremental summary incorporates its predecessor, and each completed turn appears exactly once across the summarized prefix and verbatim window. A failed summary must leave the coverage boundary intact. Switching conversations must select only that conversation's summary. Run one live compression check on seeded fictional history. Compare the summary with the original questions, pending follow-ups, and V1 references. After switching to V2, verify that the interview continues naturally, current resume advice uses V2, and the full original history is readable after reload.

### Phase 5 · Build the frontend and verify the demo

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
