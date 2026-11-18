# Rongxin Bi’s development plan

**Rongxin can complete Phases 1–5 independently.** They use local PostgreSQL, the committed migrations and the resume module already in the checkout. Phase 2 includes wiring the real SQL into Jianye’s resume service and worker. Phase 5 ends with tests of the existing AI schema. Jianye owns the remaining AI implementation. Only Phase 6 requires new code or decisions from teammates.

**Baseline, 2026-11-18.** Reviewed the checkout at `c8fb2b4` on `feat/application-interview-crud`, which matches the local `origin/main` reference. The team’s non-AI integration checkpoint is **before November 25, 2026**. Phases 1–4 below are Rongxin’s contribution to that checkpoint. The PRD sets no final delivery date. The sequence is a recommendation. A phase is complete when its acceptance checks pass.

| Order | Work package | Can Rongxin finish it independently? | Deliverable |
|---|---|---|---|
| 1 | Pool, migration command, disposable database and fixtures | Yes, using Node 26 and local PostgreSQL | A teammate can reproduce the schema and run DB tests |
| 2 | Resume library SQL and cleanup outbox | Yes, using the existing interfaces and worker | Rongxin delivers the SQL-backed resume service and cleanup worker, exercised together |
| 3 | Applications, interviews, history and guarded deletion | Yes for SQL and concurrency tests | Zishi can call tested operations and distinguish their outcomes |
| 4 | List, counts and Dashboard | Yes for database reads | Zishi and Justin get example rows and verified totals |
| 5 | Basic AI schema checks | Yes, using SQL fixtures and the existing migrations | Passing tests for workspace uniqueness, active runs and same-conversation references |
| 6 | Integration and clean setup | Requires the relevant feature owners | Real-session acceptance and a clean-environment run |

**First handoff if time is tight.** Deliver Phase 1 and Phase 2 as two reviewable changes. Jianye can then exercise the resume module while Rongxin works on applications. In Phase 3, hand Zishi the create/get/update operations as soon as their tests pass. The deletion fixture and Dashboard reads can land separately. If an HTTP decision slips, continue the database tests for that operation and record the pending decision next to the example result.

## Evidence and work already available

- **Requirements.** Use PRD 1.9 §§5, 8–11 for behavior, the Proposal for assignments, and the AI design for turn semantics. Database Design 1.13 §§5, 7–8, 10–12 and Appendices A–D/F describe the SQL and handoffs. Its November 18 revision updates the application-delete lock order. OpenAPI 1.11.0 describes the public API and still has non-AI application gaps. [PRD](PRD.md) · [Proposal](Project_Proposal.md) · [AI design](AI_Design.md) · [Database design](Database_Design.md) · [OpenAPI](endpoints.json)
- **Merged schema.** Two auth migrations supply the UUID identity. Four business migrations implement logical groups 002–005, including application, interview and AI tables. The design records an earlier local up/down/up check. Logical group 006 is the outstanding cleanup outbox. Group 007 calls for a deletion-path test of the existing foreign keys. [Migrations](../backend/migrations) · [Database design §10](Database_Design.md#migrations)
- **Merged code.** The five resume routes, service, R2 adapter, PDF processing and single-instance worker exist. The resume SQL interfaces and in-memory fakes are present. The pool currently reads configuration on import, and the transaction helper imports that pool. Application, Dashboard, auth and AI module directories are placeholders. Both server entry files are empty. The three frontend routes render navigation and headings. [Resume contract](../backend/src/modules/resumes/repository.ts) · [Fakes](../backend/tests/fakes/resumes.ts) · [Backend setup](../backend/README.md) · [Jianye’s progress log](JIANYE_DEV_PLAN.md)
- **Verification at this checkout.** Backend typecheck and build passed. All 42 existing unit tests passed, including the route tests that listen on loopback. The current package scripts are `build`, `typecheck`, `test` and `test:r2`. PostgreSQL migrations, a live R2 round trip and end-to-end authentication were outside this baseline run. [Package scripts](../backend/package.json)
- **Existing local draft.** The two PostgreSQL repositories visible in the IDE belong to the saved work for this branch. The stash object is `f265ca9`, based on `4275165`. The intervening commit changes the database design’s deletion protocol. The draft contains code worth recovering selectively and has no DB test suite. Treat its behavior as unverified.

### Recover the useful draft by file

Run these read-only commands from the repository root. The commit ID identifies this particular stash even if another stash is added. Its third parent holds the four files that were untracked when saved.

```sh
git stash show --stat --include-untracked f265ca9
git diff 'f265ca9^1' f265ca9 -- backend/src/db backend/package.json
git ls-tree -r --name-only 'f265ca9^3'
git show 'f265ca9^3:backend/src/modules/resumes/postgres-repository.ts'
```

| Draft files under `backend/` | Action when implementing |
|---|---|
| `src/db/pool.ts`, `src/db/transaction.ts` | Reuse explicit initialization and client release on rollback failure. Pass the pool to callers. The draft’s module-level singleton and `getPool()` make independent test databases and shutdown harder. |
| `migrations/20261118000700_create_storage_cleanup_jobs.ts` | Reuse this candidate for logical **006** after checking the latest migration filenames. Its timestamp orders it after the six existing files. Group 007 is separate acceptance work. |
| `src/modules/resumes/postgres-repository.ts` | Reuse the two factory functions, row mapping and claim query. Consolidate the duplicate enqueue SQL and transaction handling. Prove behavior against PostgreSQL in Phase 2. |
| `src/modules/applications/{repository,postgres-repository}.ts` | Reuse field mappings, owner-scoped interview queries and history reads. Revise link locking, update results, version/date mapping and search. The delete method currently throws. Phases 3–4 specify the replacements. |
| `src/app.ts`, `src/server.ts`, package and lockfile changes | Leave the health/startup draft for Zishi and Jianye’s wiring review. The draft adds a start command but lacks a migrate command. Build migration scripts from the current manifest and preserve the existing multer dependency pins. |

Before starting each package, compare its paths with the latest team checkout. Recover only the reviewed files or hunks into that package. Keep the stash until the recovered work has passed its tests and is safely recorded in Git.

## Phase 1 — Make the database reproducible

**Files.** Edit `backend/src/db/pool.ts`, `backend/src/db/transaction.ts`, `backend/package.json` and the database section of `backend/README.md`. Add a small DB fixture helper under `backend/tests/helpers/` and a migration test under `backend/tests/integration/`. Document test-only variables in `backend/.env.example` if introduced.

1. Expose `createPool(env)`. Read and validate the connection string when called. Let the caller own the returned pool and await `pool.end()`. Change `withTransaction(pool, callback)` to borrow one client for BEGIN, all writes and COMMIT. Roll back on failure, propagate the original error and discard a client whose rollback fails. Single statements can use either a pool or an existing transaction client.
2. Add `npm run migrate` to apply pending migrations using the locked `node-pg-migrate` dependency. Run from `backend/` on Node 26. Verify discovery of **both** the CommonJS auth files and TypeScript business files in timestamp order. The normal TypeScript build covers `src/` only. Publish the exact tested CLI invocation and how it obtains the target URL.
3. Add an explicit `npm run test:db` suite using Node’s existing test runner. Give it a dedicated test database URL, for example `TEST_DATABASE_URL`. Require that URL when someone selects the suite. Keep `npm test` usable offline. The migration cycle needs a disposable **database** because the auth migrations explicitly create tables in `public`. Run migration/reset operations serially and independently of the normal development database.
4. Insert two fictional owners directly into migrated `public.auth_user` using UUIDs, names, distinct emails and the quoted `"emailVerified"` column. This supplies genuine FK targets for SQL tests. Session and verification behavior belongs to Phase 6. For operations that commit internally, use a fresh database or committed per-test fixtures with reliable teardown. A wrapper transaction on another connection cannot undo those writes.
5. Record Node and PostgreSQL versions and migration names. On a fresh database apply all six existing files, run up again, reverse migrations on that disposable database, then reapply. Repeat the cycle with the seventh file when Phase 2 lands. Inspect the catalog for owner FKs to `public.auth_user(id)`, the composite resume-owner FK, child cascades, same-conversation constraints and the partial active-run index.

**Acceptance.** A fresh setup and a repeat run yield the same schema with one migration history. Importing the DB modules with no configured URL succeeds. Test a successful transaction, a callback failure after its first write, and a failed rollback using a controlled client. Verify durable rows, original error propagation and exactly one release per borrowed client. Typecheck, unit tests and build remain green. Give Jianye the tested migration and DB-test commands as soon as this phase lands.

Use the following as the **target developer workflow** after adding the scripts. From `backend/`, select Node 26 and install from the lockfile with `npm ci` on a clean checkout. Provide `TEST_DATABASE_URL` through the local environment, pointing at a disposable database. The explicit expansion below stops the migration command if the test URL is empty.

```sh
npm run typecheck
npm test
npm run build
DATABASE_URL="${TEST_DATABASE_URL:?Set the disposable database URL first}" npm run migrate
npm run test:db
```

## Phase 2 — Connect Jianye’s resume service and cleanup worker to PostgreSQL

**Files.** Add the cleanup migration and `backend/src/modules/resumes/postgres-repository.ts` from the reviewed draft. Add the module wiring in `backend/src/modules/resumes/postgres-module.ts`, repository tests in `backend/tests/integration/resume-repository.test.ts`, and a SQL-backed workflow test alongside them. Use Jianye’s existing service, worker and fake object storage for the service-level checks. [Interfaces](../backend/src/modules/resumes/repository.ts) · [Service](../backend/src/modules/resumes/service.ts) · [Worker](../backend/src/modules/resumes/cleanup-worker.ts)

1. Implement the outbox with UUID, private object key, extensible reason text, status, attempts, due time, last error code and audit timestamps. Enforce the three statuses, nonnegative attempts and uniqueness of `(object_key, reason)`. Index the due-job lookup. Confirm the migration’s down removes its own table.
2. Implement `insert`, `listLive`, `getLive` and `findLiveByObjectKey` with the existing TypeScript signatures. Preserve the service-generated ID and key. Store the validated page and character counts for both parse states. A live `succeeded` row carries the extracted text. A `text_unavailable` row carries SQL NULL. Return the stored camelCase metadata, with the link count derived from same-owner applications. List all live rows by `created_at DESC, id DESC`. Object-key lookup is internal to upload recovery and cleanup.
3. Implement `deleteAndUnlink` in one transaction. Lock the live owner-scoped resume, lock linked applications in ID order, tombstone the resume and clear its live text, unlink each affected application and advance its version and timestamp once. Enqueue `resume_deleted` through the same client and return the actual affected count. Missing, foreign or previously deleted rows return null. The existing worker handles private bytes after commit.
4. Implement `enqueue`, `claimDue`, `complete`, `fail` and `requeueProcessing`. Enqueue is due immediately and deduplicated. Claim due pending rows and mark them processing in a single statement using `FOR UPDATE SKIP LOCKED`. Failure records a safe code, increments attempts and sets the supplied retry time. Completion marks the job done. The worker calls requeue before every non-overlapping pass on the single instance.
5. Wire both SQL repositories at one entry point in the resume module. Accept the caller’s pool, storage and PDF extractor. Construct the PostgreSQL resume and cleanup repositories once, pass both to `createResumeService` and pass the same pair to the existing cleanup worker. Expose the service and an explicit worker-start function so server startup controls its lifetime. This is Rongxin’s implementation task. The existing offline unit tests keep their in-memory repositories for fault injection.
6. Exercise that entry point in `npm run test:db` with the real test pool, fake object storage and a deterministic extractor. Upload through the service, verify the row from a separate DB connection, link it to two applications using SQL fixtures, and delete it through the service. Verify both links clear and a cleanup job commits. Start the wired worker, verify the object disappears and the job becomes done, then await `worker.stop()`. Preserve the service’s existing behavior on uncertain inserts and the worker’s live-key check.

**PostgreSQL acceptance cases**

| Fixture or failure | Expected result |
|---|---|
| Two owners, equal upload timestamps, one unused file and one linked to two applications | Stable ordering, counts 0 and 2, foreign reads return null. After deleting the shared file, both links clear, both versions advance once and both applications remain. Repeated delete returns null. |
| Readable and text-unavailable PDFs | Both rows can be selected for linking. Stored text is NULL for the second. Repository metadata maps through the existing route serializer to the documented `textStatus` and link count. |
| Force enqueue to fail inside deletion, using an isolated DB fixture | After rollback a separate client sees the original live text, links, versions and job count. After a successful retry it sees one committed job. |
| Same action enqueued twice, future job, two concurrent claimers | One row for the duplicate action. Future jobs wait. Simultaneous claimers get disjoint IDs. Failed jobs reappear when due. Completed jobs stay complete. Requeue recovers abandoned processing jobs. |
| Real DB plus fake storage, including a queued key belonging to a live resume | The worker skips the live object. A deleted object can be retried through storage failure and process restart. Deleting the library row’s live content preserves earlier AI snapshots once the Phase 3 fixture exists. |

**Done when** the workflow test passes through the same module entry point that server startup will use. Give Jianye and Zishi its import, the migration name and the passing test command. Phase 6 mounts the returned service behind verified-user middleware and starts the worker with the configured R2 client.

## Phase 3 — Finish application writes, interviews and safe deletion

**Files.** Recover and edit `backend/src/modules/applications/repository.ts` and `postgres-repository.ts`. Add focused integration tests for applications, interviews and deletion. Zishi owns the translation from trusted request identity and public fields into these operations.

1. **Create and edit.** Require nonblank company and position, default to `saved`, preserve a missing applied date as NULL and allow duplicate company/position pairs. Accept the six stored statuses. Keep applied dates as calendar dates across timezones and preserve BIGINT versions and sequence numbers losslessly, including values above JavaScript’s safe integer range. The draft types a date as a string without controlling the driver result and calls `Number()` on versions. Select a deliberate date-only representation and round-trip decimal strings or bigint internally.
2. **Link, replace and unlink.** The draft insert delegates eligibility to an FK. Its update locks the application first. For create-with-resume, lock and validate the owned live resume before inserting. For a link-changing edit, read the current link without a write lock, lock the necessary old and new resume rows in sorted ID order, then lock the owned application. Recheck the link and any expected version. Restart from the beginning or return a distinct conflict if the state changed. Accept both usable parse statuses and check private object-key metadata in the DB. The composite FK proves ownership but allows a tombstoned row to exist. No R2 call belongs in this transaction.
3. **Status and lost updates.** Compare normalized fields with null-safe equality. An identical save preserves version and timestamp. Actual changes increment once. Under the application lock, append one ordered history record only for a real transition. Creating or entering Offer sets receipt true, including when the same transition supplies false. Leaving Offer preserves receipt. Allow an independent explicit correction. Distinguish an inaccessible application, an ineligible resume, a stale version and success internally. The current draft returns null for both stale and missing, and increments on empty updates. Leave the public version transport to Phase 6.
4. **Individual interviews.** Keep an immutable interview ID, trimmed free-text name of 1–100 characters and a required instant. Past instants are valid. Scope every operation through the owned parent. For calls identifying both application and interview, check both IDs even when one owner has several applications. Support add, ordered list, edit and delete of a single round. Let Zishi compose writes on one client if the agreed save contract includes application and interview changes together.
5. **Hard deletion.** Replace the draft’s throwing stub with the November 18 protocol. In one transaction lock the owner-filtered application, its workspace if present, then all its conversations ordered by ID. In a subsequent statement check for `preparing` or `streaming` runs. Use a visibility strategy that observes commits from writers for which the locks just waited, such as READ COMMITTED with the check after locking. An active run returns the distinct `GENERATION_ACTIVE` outcome and rolls the transaction back. Otherwise delete the application and let existing cascades remove its descendants. The route can map outcomes to 204, 404 and 409. This operation creates no storage cleanup job. [Deletion protocol](Database_Design.md#application-delete)

**Acceptance and concurrency tests**

- Create a minimal application, reject blank required fields, change among all statuses, enter Offer then Rejected, correct historical receipt, save identical values and round-trip a date near a timezone boundary. Check history sequence, flag, timestamp and version after each operation. Concurrent writers with the same expected version produce one change and one conflict. Inject a history-write failure and assert the application edit rolls back.
- Link one resume to two applications, replace only the first link, then attempt foreign and tombstoned selections. A failed replacement preserves the prior link and version. Race create-with-resume and link replacement against resume deletion in both lock orders of arrival. The serialized result has no live link to a tombstone, partial fan-out or deadlock.
- Create three interview rounds, edit the middle one and delete another. Verify stable IDs, ordering, ownership and unaffected siblings. Exercise a blank name, 100 and 101 characters, a missing time and a past time.
- Seed a realistic conversation graph with a user input, completed run, assistant answer, material snapshot, association and summary. Include another application using the same resume. Assert full cascade for the target, preserved sibling and resume, and zero outbox delta. Repeat for an application without a workspace. With either active status, assert every original row survives.
- Use two checked-out DB clients and explicit synchronization. When a generation starts first, deletion waits for acceptance and returns the active outcome. When deletion holds the workspace first, concurrent conversation creation cannot slip past the check. Also race workspace creation on an application with no workspace. Assert final rows from a fresh client. Use bounded waits and release both clients even on failure. These tests exercise logical group 007 before the AI service exists.

**Handoff.** Give Zishi the repository signatures, examples of successful and conflicting updates, status-history ordering, delete outcomes and the shared lock order. Give Jianye the requirement that generation acceptance locks the conversation before creating a run. Once both writers exist, repeat the same races via their actual entry points.

## Phase 4 — Supply application-list and Dashboard reads

**Files.** Extend the application repository’s list and detail queries. Add Dashboard queries under `backend/src/modules/dashboard/` and `backend/tests/integration/dashboard.test.ts`. Keep the result types internal until Zishi and Justin agree on their public shape.

1. Filter every query by owner. Search company and position with a bound case-insensitive literal substring and combine it with status. Escape `!`, `%` and `_` before wrapping the term in wildcards and use `ESCAPE '!'`. The draft passes wildcard characters through. Allowlist newest-first by creation time then descending ID, and company A–Z by lowercased name then ID. Include linked live resume name and nullable applied date in list rows.
2. Compute all six status counts over the owner’s entire current set, filling absent statuses with zero. Count each application once, each interview row once and each `offer_received` application once. Compute the cards independently of search, selected status and any future page limit. Use one consistent snapshot for a multi-query Dashboard response.
3. Return upcoming interview IDs, parent IDs, names, company, position and start instants ordered by `starts_at, id`. Accept two bound instants for the half-open range from local midnight today through local midnight seven dates later. Use explicit boundaries in the DB tests. Zishi can supply the validated display timezone when wiring the API in Phase 6. Return recent applications from the same newest-first ordering. A display limit can be passed by the caller.
4. Give Justin and Zishi a small fixture with expected list rows, counts and IDs. Keep response envelopes, pagination and route names with the API owners. Jianye can reuse the owner-scoped search for the AI position selector.

**Acceptance.** Start with two applications for owner A, one in Saved and one in Rejected after Offer, and three interview rows on the second. Add records for owner B. Expect A’s totals to be **2 applications, 3 interviews, 1 offer**. Search for a company fragment and a literal percent sign, exercise both sorts with tied values, then filter to zero rows. Status counts still sum to two. Test interviews exactly at both boundaries and earlier today. For example, Toronto October 29 to November 5, 2026 spans 169 hours between local midnights. Include the first instant and exclude the last. After deleting A’s second application, expect **1, 0, 0** and no interviews or recent entry for the deleted application.

## Phase 5 — Verify the existing AI schema independently

**Files.** Add `backend/tests/integration/ai-schema.test.ts` to the Phase 1 DB suite. Seed records with parameterized SQL against migrations 004–005. Reuse the Phase 3 application and conversation fixtures. All inputs are local and the assertions follow constraints already in the database. [Workspace migration](../backend/migrations/20261116000300_create_ai_workspaces_conversations.ts) · [AI persistence migration](../backend/migrations/20261116000400_create_ai_persistence.ts)

| Test | Expected database result |
|---|---|
| Insert a second workspace for one application, then create two conversations in the first workspace | The duplicate workspace is rejected. Both conversations are stored with distinct IDs. |
| Create a preparing run, then attempt a second active run in that conversation and one in the other conversation | The first conversation rejects the second active run. The other conversation accepts its own run. |
| Associate a run in one conversation with a material snapshot from the other, then try a matching pair | The composite foreign key rejects the cross-conversation pair. The valid association persists. |

**Done when** the three cases pass with the disposable PostgreSQL database. Reuse Phase 3’s cascade and active-generation deletion tests as evidence for that behavior. Jianye owns the AI repositories and turn transactions, material selection and versioning, retry and recovery, model calls, streaming, and the AI API and frontend. [AI design](AI_Design.md)

## Phase 6 — Team integration after the independent work

| Dependency | Team check |
|---|---|
| Zishi’s verified-user middleware and server startup, plus Jianye’s development R2 configuration | Mount the Phase 2 service and start its worker. With two real accounts, check private access, upload, unlink and eventual object cleanup. |
| Zishi’s application API and Justin’s OpenAPI and client updates | Align status and date formats, interview edits, version conflicts and Dashboard responses. Compare the resulting pages with the Phase 3–4 fixtures. |
| Jianye’s AI implementation | Jianye verifies the end-to-end chat, retry and isolation flows. Repeat the Phase 3 active-generation deletion check through the live API. |

**Team acceptance.** A teammate follows the database setup from a clean checkout and runs the documented checks. Record the independent DB results when available and the end-to-end results when the corresponding features are integrated.
