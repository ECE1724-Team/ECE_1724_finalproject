# R2 / PDF foundations — implementation plan phases 1–3

The backend contains the storage adapter, PDF extractor, resume acceptance policy,
offline test sources and an opt-in real R2 check. It does not yet start an HTTP
server or persist resume records. Phase 4 workflow orchestration is not included.

`npm run typecheck`, `npm test` (15 offline tests) and `npm run build` pass on
Node 26.8.2. The live R2 check has not been run yet (it needs a development
bucket), so real storage compatibility remains unverified.

## PDF storage: Cloudflare R2

Resume PDFs use a private Cloudflare R2 bucket through its S3-compatible API.
The intended integration checks file ownership on the backend before sending
a PDF to the browser, with extracted text and metadata stored in PostgreSQL.
Authentication, routes, persistence, and durable cleanup remain later integration work.

1. Create a private R2 bucket. Keep public access via `r2.dev` and public custom domains disabled.
2. Create R2 S3 credentials with object read/write permissions scoped to that bucket. Keep credentials on the backend only.
3. Set the variables listed in [.env.example](.env.example): `R2_ENDPOINT` (normally `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Use the endpoint shown for your bucket. The region is fixed to `auto` in code.

`R2_PUBLIC_BASE_URL` is not needed: the intended browser access path is the
authenticated backend file endpoint. The R2 adapter, worker-based PDF extraction,
and resume PDF policy are implemented independently of HTTP and database integration.
The sections below describe configuration, module usage, and manual verification commands.

## Setup and manual commands

Use Node **26.x** (recorded in `.nvmrc` and `package.json`). This implementation
baseline matches the inspected local Node 26.8.2 installation; it is not evidence
of a team deployment agreement. The existing dependencies are retained:
`@aws-sdk/client-s3` 3.1169.0 and `pdfjs-dist` 6.5.438. No test framework dependency
is needed: TypeScript compiles tests and Node's built-in runner executes them.

From `backend/`:

```sh
nvm use
npm ci
cp .env.example .env
npm run typecheck
npm test
npm run build
```

Only copy `.env.example` if you do not already have a local `.env`. Offline tests
need no credentials, database, authentication, frontend or LLM. They do not load
`.env`. `npm run typecheck` includes both source and tests. Production output is
in `dist/`; the test build uses `dist/tests/` and runs its compiled test files.
The `.mts` PDF worker compiles to `.mjs` while the backend remains CommonJS.
Deploy the complete compiled source tree and installed runtime dependencies,
including PDF.js's local `cmaps/`, `standard_fonts/` and `wasm/` assets.

For the real storage check, configure an **isolated development bucket** in `.env`
and set `R2_INTEGRATION_TEST=1`, then run:

```sh
npm run test:r2
```

Without opt-in or credentials, the check is reported as **skipped**, not passed.
It uses one random key below `integration-tests/`, checks collision rejection,
compares original bytes, inspects metadata, deletes twice and verifies absence.
Cleanup deletes only that freshly generated key. A process crash can still leave
the test object behind. This check never lists or bulk-deletes the bucket.

## Module entry points

| File | Responsibility |
|---|---|
| `src/config/env.ts` | Explicit R2 configuration reader; no import-time secrets or client creation |
| `src/integrations/object-storage/types.ts` | Project-owned storage interface and safe error categories |
| `src/integrations/object-storage/r2.ts` | Conditional creation, whole-file reads, metadata, idempotent deletion, random keys |
| `src/integrations/pdf/types.ts` | Extracted page evidence, character counting and internal errors |
| `src/integrations/pdf/extractor.ts` | Shared concurrency limit, worker lifetime, deadline and cancellation |
| `src/integrations/pdf/worker.mts` | PDF.js parsing, local font/CMap resources, text joining and cleanup |
| `src/modules/resumes/pdf-policy.ts` | PRD byte/page/text rules, independently of storage and SQL |

Create **one shared extractor per backend process** when the future server starts;
creating one per upload would bypass the intended concurrency limit. Initialize
storage explicitly after loading configuration. The functions read `process.env`
but do not load a `.env` file themselves; use Node's `--env-file=.env` when launching
the future server. The following illustrates the adapter boundary, not a complete
upload transaction:

```ts
import { readR2Config } from "./config/env.js";
import { createPdfExtractor } from "./integrations/pdf/extractor.js";
import { createObjectKey, createR2Storage } from "./integrations/object-storage/r2.js";
import { validateResumePdf } from "./modules/resumes/pdf-policy.js";

const pdf = createPdfExtractor();
const storage = createR2Storage(readR2Config());

// Within a future authorized handler, after bounded multipart reception:
// Throws PdfError for rejected files; otherwise the file is accepted and stored.
const result = await validateResumePdf(bytes, pdf, { signal });
const objectKey = createObjectKey();
await storage.putNew(objectKey, bytes, { signal });
// Future workflow saves objectKey and, when result.textStatus === "available",
// result.extraction.text; "unavailable" saves no text and returns the AI warning.
// storage.close() releases the SDK client on application shutdown.
```

`putNew` accepts only server-generated keys and writes immutable PDF bytes using
`If-None-Match: *`. It does not perform PDF validation; call the resume policy first.
`read` and `head` return `null` for an absent object. `delete` is safe to repeat.
All other failures remain errors. Never accept a storage key from browser input.
Because resumes are at most 2 MiB, `read` returns the complete file as `bytes`
rather than a stream; the deadline covers the whole download, and a truncated
download is an error, never a shorter file. Pass a signal tied to client
disconnection so abandoned downloads stop.

No list-bucket, rename, overwrite, public URL or direct browser upload operation
is provided. The personal resume list will come from PostgreSQL. Bucket public
access must remain disabled; SDK code does not change bucket permissions.

## Acceptance rules and deterministic text

This follows the text-unavailable rule proposed on 2026-11-15 (PRD §5.2), which
is still pending team confirmation.

`validateResumePdf` **rejects** (throws `PdfError`) files over **2,097,152 bytes**,
non-PDF, damaged or password-required files, and files with more than **two pages**.
File name and declared MIME type are not trusted. The first 1024 bytes are checked
for the PDF signature as an inexpensive filter, then PDF.js must successfully parse
the bytes. Readable encryption with an empty user password is allowed.

Every other file is **accepted**, with one of two results:

- `{ textStatus: "available", extraction }`: at least **100 non-whitespace Unicode
  code points across the whole document** and at least one on **each** page. An exact
  byte/character boundary passes. `extraction.text` is what the AI will use.
- `{ textStatus: "unavailable", pageCount, nonWhitespaceChars }`: the text rules
  failed (e.g. a scanned, image-only or blank page). The file is still stored and
  linkable, but no text is saved and the UI warns that AI features cannot read it.
  This result deliberately contains no text, so partial text never reaches the AI.

There is no OCR or image-count restriction.

Text retains PDF.js content order. Explicit end-of-line markers and changes in
baseline introduce line breaks; horizontal gaps separate words or text blocks.
Horizontal whitespace is collapsed to spaces, lines are trimmed, more than two
consecutive newlines collapse to two, and pages join with `\n\n`. No summarization,
case folding, Unicode normalization, content truncation or dehyphenation is done.
Character counts iterate Unicode code points and exclude ECMAScript `\s`
whitespace, so supplementary characters count once; grapheme clusters can contain
multiple code points. Each page returns its text and count as validation evidence.

PDF content order is not guaranteed to match visual reading order for every
exporter. The fixtures include authored one-column and two-column examples, but
representative Word/LaTeX exports still need manual reading-order inspection before
acceptance. The extractor deliberately avoids a global coordinate sort that can
interleave unrelated columns. Saved text must be reused verbatim by future AI
fingerprinting; parser upgrades require another extraction-quality review.

## Operational defaults and error handling

These are constants in code, not environment variables, product rules or
measured performance guarantees. Change them in the named file if needed:

| Value | Where | Reason |
|---|---|---|
| 3 total attempts | AWS SDK default | Bounded retries for transient failures |
| 30,000 ms | `REQUEST_TIMEOUT_MS` in `r2.ts` | Caps each operation including retries and the body download |
| 2 per process | `MAX_CONCURRENT` in `extractor.ts` | Keeps CPU/memory use bounded without an unbounded input queue |
| 15,000 ms | `TIMEOUT_MS` in `extractor.ts` | Allows small PDFs time to load while terminating stalled work |
| 256 MiB | `WORKER_MEMORY_MB` in `extractor.ts` | Caps each worker's V8 old-generation heap |

The PDF deadline includes worker startup and resource cleanup. Cancellation and
timeout terminate the worker and await its termination before freeing its slot.
Normal success/failure calls `page.cleanup()` and `loadingTask.destroy()`. A forced
termination reclaims the worker instead of running its JavaScript cleanup.
The memory setting is **not** a hard process RSS or native/ArrayBuffer allocation
cap; deployment memory limits remain a separate integration responsibility.

`PdfError.code` is one of `invalid_pdf`, `too_large`, `too_many_pages`,
`unreadable_encryption`, `processing_failed`, `timeout`,
`cancelled`, or `busy`. The last four describe execution state, not proof that
the user's PDF is invalid. Excess concurrent requests return `busy` immediately;
the caller may offer retry. Policy errors and operational errors have separate
safe messages. No parser diagnostics or document contents are forwarded to logs.

`StorageError.code` is `conflict`, `access_denied`, `timeout`, `cancelled`, or
`service_error`. Raw SDK errors, signed requests and credentials are not attached
to these public module errors. A HEAD 404 has no response body, so the service's
generic not-found response cannot always distinguish a missing key from every
bucket configuration problem; explicit `NoSuchBucket` errors remain failures.

Timeouts/cancellation do **not** prove a write failed: R2 can finish a write before
the acknowledgement is lost, and a retry may then encounter the condition conflict.
Keep the generated identity for later reconciliation. Do not blindly overwrite,
delete, or finalize SQL based on an ambiguous write result.

## Test sources and remaining integration

`tests/fixtures/pdf.ts` creates fictional PDFs with real objects, text streams and
cross-reference offsets. Unit cases cover one/two columns, one/two/three pages,
99/100 characters, Unicode code points, blank/image-only pages, mixed text/images,
damaged and renamed input, exact byte boundaries, compression,
repeated extraction, original-byte preservation, cancellation, timeout
and capacity release. At the requester's direction, the failing cross-page
99+1-character and encryption cases were removed; their underlying failure causes
remain unresolved, and those behaviors are not established by the remaining tests.
Unicode fixtures use ToUnicode mappings for extraction;
they are not typography/rendering reference files. Fake S3 tests cover the four
operations, failures, cancellation and deadlines.

Before HTTP integration, the team still needs to supply verified authentication,
bounded multipart receiving (stop at 2 MiB while receiving), ownership checks,
repository/transaction contracts, safe response filenames, private/no-store HTTP
headers, durable cleanup/reconciliation, and public error/status mappings. The
existing OpenAPI `Resume` schema lacks parsing state and link counts; agree those
changes with its owner instead of adding undeclared response fields here.

The implementation follows Cloudflare's [S3 SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/),
[S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/) and
[conditional write semantics](https://developers.cloudflare.com/r2/api/s3/conditional-operations/),
plus PDF.js's [Node extraction example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs).
These references support the adapter design; they do not substitute for running
the real R2 and PDF acceptance checks.
