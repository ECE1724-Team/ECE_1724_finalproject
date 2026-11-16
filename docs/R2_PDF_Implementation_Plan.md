# R2 and PDF Implementation Plan

Prepared for Jianye Zhou on November 15, 2026, from the current local checkout.

**Implementation update (November 15, 2026):** Source code and manual test entry
points for Phases 1–3 are now present. See the [backend handoff](../backend/README.md)
for module interfaces, configuration, runtime choice, commands and remaining
integration work. At the requester's direction, builds, typechecks, tests and live
R2 verification were not executed. The completion criteria below therefore remain
pending verification. The original checkout observations below describe the
planning snapshot, not the updated implementation. Phase 4 is not implemented.

## Recommendation

You can complete the R2 adapter and PDF validation/extraction before your teammates finish authentication, database access, or frontend pages. These are the most useful independent pieces because their behavior is already defined and their inputs can be ordinary bytes and configuration.

Build these modules first, then test the resume workflow through small dependency interfaces. Connect real authentication, PostgreSQL transactions, and HTTP routes after the relevant contracts are agreed. This reduces likely rework; it cannot guarantee that integration will require no changes.

Do not implement a generic file CRUD feature. The product needs creation, reading, and deletion of immutable PDF objects. It explicitly excludes renaming, editing, and overwriting an uploaded resume. A new version gets a new resume record and object key; selecting that version changes an application's database link. The personal resume list also comes from PostgreSQL, not from listing an R2 bucket.

## What exists today

The review covered the application source, frontend components and styling, configuration, package manifests and lockfile dependency information, all five existing design/API documents, and both READMEs. Generated dependencies and build outputs were not treated as project implementation. This is evidence from the local checkout, not a claim about teammates' unpublished branches or deployed services.

The backend currently has empty `app.ts`, `server.ts`, `config/env.ts`, `db/pool.ts`, and `db/transaction.ts` files. The authentication, applications, resumes, dashboard, AI, and integration directories contain placeholders. Migrations, seeds, and test directories also contain placeholders. There are no implemented business routes, SQL repositories, PDF processors, or R2 clients to reuse yet.

The backend declares Express, Better Auth, PostgreSQL, TypeScript, and migration tooling. Neither an S3 client nor a PDF parser is present in its lockfile. Its only npm script is a placeholder test command that exits with an error. The package uses CommonJS with TypeScript's NodeNext module setting; the existing TypeScript configuration includes only `src/**/*.ts`. Tests placed under `tests/` will need an explicit runner or test configuration.

The frontend has React routing, navigation, styling, and reusable menu components. Dashboard, Applications, and AI Interview currently display page headings rather than working business flows. There is no implemented resume dialog, authentication flow, or API integration to depend on.

R2 configuration is documented in the root README and `backend/.env.example`. The local OpenAPI file is version 1.7.0 and now accepts PDF only. It defines resume list, upload, metadata, delete, and file-download operations, but the `Resume` response still lacks parsing status, parsing errors, and linked-application count. The download contract specifies an attachment; preview behavior needs agreement. The database design is a proposal, including its physical authentication key and transaction mechanisms. Some historical appendices still describe older API versions, so use the current OpenAPI and confirmed PRD rules when checking a contract.

No live R2 bucket, credentials, database, or deployed endpoint was tested for this plan. No application tests or builds were run; the backend's placeholder test command would not establish feature correctness.

## Keep the work inside the existing boundaries

Put the R2 implementation in `backend/src/integrations/object-storage/` and PDF extraction in `backend/src/integrations/pdf/`. Put resume policy and workflow orchestration in `backend/src/modules/resumes/`. Use the existing `backend/tests/fixtures/`, `integration/`, and `contract/` locations, adding focused unit tests as needed.

The storage adapter should receive configuration and operate on server-generated keys. It should not import Express, query users, or decide whether a resume is selectable. The PDF adapter should accept bytes and return page text and extraction results. Resume policy should apply the project's acceptance rules to those results. Neither adapter should import AI code.

Keep SDK response objects and parser-specific types inside their adapters. Return small project-owned types instead. This lets you change a parser import or adjust an SDK setting without rewriting routes, SQL, or AI code.

Keep credentials out of import-time global initialization. Construct the real R2 client explicitly when its configuration is available; tests can supply a fake. A missing R2 configuration should fail clearly when real storage is initialized, while pure PDF tests remain runnable without any cloud account.

Leave authentication internals, application endpoints, business migrations, and non-AI frontend pages with their owners. Coordinate the small shared changes to backend scripts and dependency files rather than replacing the backend setup. Use a focused branch such as `codex/r2-pdf-foundation`; keep the existing uncommitted PDF-only API edit separate from unrelated work.

## Phase 1: Establish a runnable module test setup

Start with a small compatibility check before writing the complete workflow. Agree the team's supported Node runtime and verify that the chosen S3 client and PDF parser work with the existing backend module settings. The inspected machine reports Node 26.8.2, but a local installation does not establish the team's deployment runtime. Do not convert the entire backend to ESM just to accommodate a parser.

Use `@aws-sdk/client-s3` for the R2 adapter, following Cloudflare's [JavaScript SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/). Evaluate PDF.js as the initial extraction candidate: its [Node example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs) exposes page count and page-level text. Verify the installed version's imports, resource cleanup, and actual extraction quality before locking the choice. Avoid selecting a parser that returns only one combined string, because the PRD requires validation of every page.

Add a minimal test command and type-check coverage for both source and tests. Record exact working commands when they exist, and update the lockfile with the chosen dependencies. No database, login server, frontend, or LLM call is needed for this phase.

This phase is complete when a test can import both adapters under the intended runtime, extract text from a fictional PDF, and exercise storage behavior with a fake client. A successful import alone does not establish R2 compatibility.

## Phase 2: Complete the R2 adapter

Implement a narrow storage interface with four operations: write a new object, open an object for reading, inspect its metadata, and delete an object. These correspond to `PutObject`, `GetObject`, `HeadObject`, and `DeleteObject`. Return a stream for reads and ordinary metadata such as content type and length. Keep object listing separate for later maintenance; it is not the user's resume-list API. Check behavior against Cloudflare's [S3 compatibility reference](https://developers.cloudflare.com/r2/api/s3/api/).

Use the existing `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_REGION=auto` settings. Keep the bucket private and credentials on the backend. The approved path needs neither a public file domain nor browser-to-R2 uploads. Browser-to-backend origin and cookie configuration still belongs to HTTP integration.

Generate opaque random object keys independently of email addresses, filenames, and the eventual authentication key type. Each new resume receives a fresh key. Treat an existing-key collision as a conflict, not permission to overwrite another file. Set the PDF content type and preserve the original bytes. A browser's multipart form upload and S3 multipart object upload are different mechanisms; a resumable S3 multipart workflow is unnecessary for the current 2 MiB limit.

Distinguish an absent object from denied credentials, timeouts, and service failures. A failed read must never look like an empty PDF. Deleting an already absent object should be safe for cleanup retries; other failures must remain visible. Provide bounded request attempts and cancellation, with settings recorded as implementation choices rather than product requirements. Do not log credentials, file bytes, extracted text, or signed request details.

Verify the adapter against an isolated development R2 bucket once credentials are available. Create a uniquely named test object, read it back, compare bytes, inspect metadata, delete it, and verify absence. Clean up only objects created by that test. Keep this check separate from ordinary offline tests, and report missing credentials as a skipped integration check rather than a pass.

This phase can be finished without teammates' code. Completion means both useful failure-path tests and a successful real R2 round trip, not merely mocked SDK calls.

## Phase 3: Complete PDF validation and extraction

Accept file bytes rather than a URL. Validate actual content, not just the `.pdf` extension or claimed MIME type. Check the real byte count before parsing, reject empty files, and enforce the confirmed maximum of 2,097,152 bytes. The eventual multipart handler must also stop oversized input while receiving it; checking size only after allocating an unlimited buffer is insufficient.

Enforce one or two pages, at least 100 non-whitespace characters across the document, and extractable nonblank text on every page. Reject damaged or unreadable files and encryption that prevents extraction. Do not reject every encrypted file automatically if it can be read normally. Do not add DOCX support, OCR, an image-count limit, or a requirement for 100 characters on each page.

Return the extracted text, page count, total non-whitespace character count, and enough per-page evidence to enforce the rule. Define deterministic joining and whitespace handling so the saved text is stable. Preserve readable word, line, and page boundaries; do not summarize, rewrite, or silently truncate the resume. Use representative one-column and two-column files to inspect reading order. The same saved text will later be used for AI fingerprints.

Use small machine-readable error categories for invalid PDF, excessive size or pages, insufficient text, unreadable encryption, and processing failure. These are internal categories until Justin agrees their public API names and HTTP mappings. Infrastructure errors should not tell users that their PDF is invalid.

Small compressed files can still take substantial processing time or memory. Check parser cleanup on success and failure, bound concurrent parsing, and test cancellation. If the chosen parser cannot be interrupted reliably, run extraction in a terminable worker. Merely racing parsing against a timeout does not stop the underlying work. Choose operational limits after the compatibility check and document the rationale without silently changing the PRD's accepted file rules.

Use fictional fixtures covering valid one- and two-page files, exactly 100 characters, 99 characters, an empty page, an image-only page, three pages, damaged input, unreadable encryption, and a DOCX or other file renamed to `.pdf`. Verify the exact size limit and one byte over it with valid boundary fixtures. Include non-ASCII text and define character counting consistently rather than accidentally counting bytes.

This phase can also be completed independently. It is complete when real fixtures establish the acceptance rules and readable output, including deterministic repeated extraction and resource cleanup.

## Phase 4: Prepare the resume workflow without inventing teammates' implementations

After the adapters are stable, implement workflow logic against a small repository interface. Use an opaque `userId` supplied by a trusted caller, a PDF extractor, a storage adapter, and repository methods for pending creation, conditional success/failure updates, authorized lookup, and atomic deletion preparation. These are proposed internal contracts to review with Rongxin and Zishi, not final SQL or public API schemas.

Keep the public HTTP response separate from the internal record. The internal record needs object identity and extracted text; ordinary library responses should not expose either. Database snake_case fields and public camelCase fields should be mapped deliberately.

For the first release, propose finishing parsing during the upload request and returning success only after the object and usable database record are saved. This is the simplest candidate for the small file limit and existing `201` response, but it remains a team agreement, not a settled contract. If asynchronous parsing becomes necessary, the same extraction and storage modules should remain usable behind a worker; only orchestration and status delivery should change.

The proposed upload sequence is: validate the bounded input, create pending metadata, extract and validate text, save the original PDF to R2, then conditionally mark the record successful with its text and validation metadata. Keep parsing and storage requests outside database transactions. Uploading never changes an application's existing resume link. Finalization must reject a record deleted while processing was underway.

Failure handling must distinguish confirmed failure from an unknown outcome. If R2 upload succeeded and the database update definitely rolled back, remove the unreferenced object or record durable cleanup. If a database commit acknowledgement was lost, first reread the record by its stable identity; blindly deleting the object could destroy a successfully committed resume. If that check is unavailable, leave reconciliation work rather than guessing. A timed-out R2 write can also finish late, so one immediate delete attempt is not sufficient crash recovery.

Use fakes only in tests to verify sequencing, ownership checks, cleanup requests, and late finalization. Do not mount a development endpoint with a hardcoded user or turn an in-memory repository into a production fallback. Fakes cannot prove SQL locking, rollback, durable cleanup, or real authentication.

This phase can establish the workflow's behavior before the database exists. It is complete as a tested module, while production persistence and HTTP integration remain explicitly unfinished.

## The agreements that prevent most integration rework

With Zishi, agree how verified authentication context reaches a handler and how protected routes are mounted. Treat `userId` as an opaque string; the database document's UUID auth-key candidate is still a proposal. Never accept ownership from an upload form, URL-supplied object key, or client verification flag. Session validation and verified-email checks must happen before expensive multipart processing. Coordinate origin/CSRF protection for custom cookie-authenticated file routes rather than assuming protection of auth routes automatically covers them.

With Rongxin, agree the repository method inputs, returned fields, and ownership of each transaction. In particular, expose deletion preparation as one atomic operation, not separate calls for marking deleted, unlinking applications, and adding a cleanup job. Follow the documented resume-before-application lock order across both application linking and resume deletion. Rongxin owns the real SQL, migrations, foreign keys, and cleanup-job persistence; you own storage deletion behavior and coordinate the retry runner.

With Justin, close the resume-specific API gaps before final route/UI integration. Agree parsing status/error fields, linked-application count, upload completion semantics, and mappings for size, validation, and storage failures. The existing `Resume` schema sets `additionalProperties: false`, so adding fields in code alone would violate it. Keep the existing route paths unless a concrete need requires a change. Resume deletion already returns `200` with `unlinkedApplicationCount`; do not implement the obsolete `204` description found in a historical appendix.

For preview, the least disruptive candidate is an authenticated fetch of the existing file endpoint, followed by a browser Blob URL in Justin's viewer. Keep the documented attachment behavior for ordinary downloads. Agree this with Justin and test it in Chrome and Edge before adding a new preview route or query parameter. Revoke Blob URLs when the viewer closes. File responses should use the PDF content type, safe filename handling, and private no-store caching; stop the storage read when the client disconnects. No application can revoke bytes a user has already downloaded.

For application association, Zishi's API must validate that the selected resume belongs to the same user, parsed successfully, and is not deleted. Do not add a second competing link endpoint in the storage module. The current application update is a full replacement, so sending only `resumeId` would be incorrect and could clear other fields; its final usage must be coordinated with Justin and Zishi.

These discussions need small interface examples, not completion of every teammate's feature. You can continue Phases 1–3 while the agreements are being made.

## Finish deletion and recovery when persistence is ready

Deleting an R2 object is only one part of deleting a resume. The database transaction must authorize and mark the resume inaccessible, unlink every affected application, advance application row versions, clear current extracted text, and enqueue object cleanup. After commit, a worker deletes the R2 object and retries failures. Report the actual unlink count from the transaction; the count shown before confirmation can change concurrently.

Do not delete the object before this transaction commits. If R2 is unavailable, new downloads and links must still be denied by database state. A late parser must not restore the deleted record. Deleting an application must leave its library resumes intact. Historical AI snapshots remain readable within retained conversations; resume cleanup must not erase them.

The cleanup runner needs durable job claiming, retry scheduling, and a visible way to find persistent failures. Start with the proposed database cleanup table and a small worker; do not introduce Redis or a general job platform just for this feature. A periodic reconciliation pass is also needed for crashes or uncertain writes that leave objects without a completed cleanup job. Before deletion, reconcile against authoritative database state, protect active uploads, and use an agreed age window. Never delete live resume objects through a blanket lifecycle expiry rule.

This is a later integration milestone. The worker's delete action can be tested now, but its durable behavior, locking, and crash recovery must be tested against the real database before the resume feature is declared complete.

## How this connects to AI

The handoff to AI is the successfully parsed resume record: stable identity, upload-time name, saved text, and usability state, reached through the authorized application's current `resumeId`. R2 remains the source of original file bytes for viewing and downloading. AI conversations read saved text without downloading or parsing the PDF again.

Uploading V2 does not change AI context until an application selects V2. On its next turn, each conversation independently reads the current materials, computes fingerprints from identity and exact content, and saves or reuses its own snapshots. The PDF module does not update every conversation or maintain an AI version counter. The proposed extraction `content_version` is audit metadata, not the AI change detector.

Prepare fictional V1/V2 records and missing/failed/deleted cases now so the later context code can be tested without R2 or an LLM. Include two distinct resume IDs with identical text, because their identity still distinguishes them. A generation whose material snapshot was already fixed keeps that snapshot; a later turn observes replacement or deletion. A database read failure must not be converted into a successful 'resume missing' result.

Do not make AI snapshot tables, a model provider, or streaming chat prerequisites for finishing the storage and parser modules. They belong to the later AI integration phase.

## Completion and handoff

Use three small implementation changes: first the test setup and R2 adapter, then PDF extraction and acceptance tests, then resume workflow interfaces and failure-path tests. This keeps dependency changes and review scopes manageable. Reserve a separate integration change for real authentication, SQL repositories, HTTP contracts, and UI wiring.

You can finish now: the storage adapter, real R2 smoke check when credentials are available, PDF parser and policy, fictional fixtures, and workflow tests behind agreed interfaces. You can prepare the cleanup action and AI-facing fixture data. You cannot yet prove the complete feature's authorization, transaction safety, durable retries, or browser behavior using only those modules.

Before calling the integrated feature complete, demonstrate an upload visible after reload, owner-only preview/download, one file reused by two applications, replacement affecting only one link, and failed replacement preserving the old link. Also demonstrate deletion with R2 unavailable, eventual object cleanup, rejection of a concurrent link or late parser completion, and a restarted worker recovering unfinished work. Run permission cases with anonymous, unverified, revoked-session, and different-owner users against real authentication. Keep these results separate from offline unit-test results.

The project targets the non-AI workflow before November 25, 2026. Complete the independent foundations first and leave explicit time for teammate integration; their readiness is not established by the current checkout. The handoff should contain working test commands, configuration instructions without secrets, reviewed internal interfaces, fixture expectations, real R2 check results or a clearly recorded skip, and a short list of integration work still outstanding.

## Project references

The [PRD](PRD.md), especially §5.2, FR-02, FR-08–09, FR-26–28, and FR-34, establishes file acceptance, access, linking, and deletion behavior. The [Database Design](Database_Design.md), especially §5.2, §5.11, §6.1, §7.1–7.3, and Appendix D, supplies proposed persistence and identity boundaries. The [AI Design](AI_Design.md) establishes saved-text reuse, fingerprints, and historical snapshots. The [Proposal](Project_Proposal.md) establishes team responsibilities. The current [OpenAPI contract](endpoints.json) supplies route shapes, while the [root README](../README.md) and [environment example](../backend/.env.example) record the R2 configuration.
