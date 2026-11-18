# Backend

Express + TypeScript backend. Use Node **26.x** (see `.nvmrc`).

## Setup and commands

From `backend/`:

```sh
nvm use
npm ci
cp .env.example .env   # only if you don't have a .env yet
```

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks `src/` and `tests/`, writes nothing |
| `npm test` | Compiles to `dist/tests/` and runs the offline unit tests (no credentials, database or network needed) |
| `npm run build` | Compiles `src/` to `dist/` for running or deploying |
| `npm run test:r2` | Optional real R2 check, see below |

`dist/` is build output and is not committed. Deploy it together with `node_modules`
(the PDF parser loads font data from `pdfjs-dist` at runtime).

## Resume storage and PDF parsing (R2 / PDF)

Owner: Jianye Zhou. Design and remaining work: [implementation plan](../docs/R2_PDF_Implementation_Plan.md);
file rules: [PRD §5.2](../docs/PRD.md).

**Status:** the R2 adapter, PDF extraction and resume acceptance rules are done and
unit-tested. Not done yet: HTTP routes, auth checks, database records, receiving
uploads with a 2 MiB cut-off, and background cleanup of deleted files. These need
the auth, database and API work from the rest of the team.

### R2 setup

1. Create a **private** R2 bucket (keep `r2.dev` and public custom domains off).
2. Create an R2 API token with object read/write on that bucket only.
3. Fill in `.env`: `R2_ENDPOINT` (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`),
   `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

Browsers never talk to R2 directly; PDFs are served through the authenticated backend.

To test against real R2, point `.env` at a **development-only** bucket, set
`R2_INTEGRATION_TEST=1` and run `npm run test:r2`. It writes, reads and deletes one
random test object. Without that flag it is reported as skipped.

### Using the modules

| File | Purpose |
|---|---|
| `src/config/env.ts` | `readR2Config()`: reads and checks the R2 variables |
| `src/integrations/object-storage/r2.ts` | `createR2Storage()`, `createObjectKey()` |
| `src/integrations/pdf/extractor.ts` | `createPdfExtractor()`: parses PDFs in a worker thread with a timeout and a concurrency limit |
| `src/modules/resumes/pdf-policy.ts` | `validateResumePdf()`: the PRD file rules |

```ts
// Once at server startup. Use ONE extractor per process (it holds the concurrency limit).
const pdf = createPdfExtractor();
const storage = createR2Storage(readR2Config());

// In the upload handler, after auth and after receiving at most 2 MiB:
const result = await validateResumePdf(bytes, pdf, { signal }); // throws PdfError if rejected
const key = createObjectKey();                                   // never use a key from the browser
await storage.putNew(key, bytes, { signal });
// Save key in the database, plus result.extraction.text when result.textStatus === "available".
```

- **Rejected** (`PdfError`): over 2 MiB, not a PDF, damaged, password-protected, more than 2 pages.
- **Accepted, `textStatus: "available"`**: at least 100 non-whitespace characters and text on every page. `extraction.text` is what the AI uses.
- **Accepted, `textStatus: "unavailable"`**: e.g. a scanned or image-only resume. Stored and linkable, but no text is saved and the UI shows an AI warning. Confirmed 2026-11-17 (PRD §5.2); the database stores it as `parse_status = 'text_unavailable'`.

Storage operations: `putNew` refuses to overwrite an existing key; `read` returns the
whole file as `bytes` (or `null` if missing); `head` returns metadata (or `null`);
`delete` is safe to repeat. Pass a `signal` so a cancelled request stops the work.

### Errors

| Error | Codes |
|---|---|
| `PdfError` | File problems: `invalid_pdf`, `too_large`, `too_many_pages`, `unreadable_encryption`. Server-side, worth a retry: `processing_failed`, `timeout`, `cancelled`, `busy` |
| `StorageError` | `conflict`, `access_denied`, `timeout`, `cancelled`, `service_error` |

How these map to HTTP status codes is still to be agreed with the API/frontend owner.
A storage `timeout` does not prove the write failed, so don't delete or overwrite based on it.

Limits are constants in code: R2 timeout 30 s (`r2.ts`), PDF parse timeout 15 s,
2 parses at a time and 256 MB worker heap (`extractor.ts`).

### Known gaps

- Text order follows the PDF's internal order. Unusual two-column layouts may come out
  interleaved, so check a few real Word/LaTeX exports by hand.
- Tests for encrypted PDFs and for 99 + 1 characters split across pages were dropped
  because their fixtures failed; that behavior is untested.
