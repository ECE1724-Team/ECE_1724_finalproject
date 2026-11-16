import { PdfError, type PdfExtraction, type PdfExtractor } from "../../integrations/pdf/types.js";

export const MAX_RESUME_BYTES = 2_097_152;
export const MAX_RESUME_PAGES = 2;
export const MIN_RESUME_CHARACTERS = 100;

// An accepted resume either has text the AI can use, or is stored without text
// (e.g. a scanned PDF): still viewable, downloadable and linkable, but the UI warns
// that AI features cannot read it. The unavailable case deliberately carries no
// text, so partial text from such a file can never reach the AI.
export type ResumePdfResult =
  | { textStatus: "available"; extraction: PdfExtraction }
  | { textStatus: "unavailable"; pageCount: number; nonWhitespaceChars: number };

// Throws PdfError for files that must be rejected (too large, not a PDF, damaged,
// password-required, too many pages, or a processing failure).
export async function validateResumePdf(
  bytes: Uint8Array,
  extractor: PdfExtractor,
  options: { signal?: AbortSignal } = {},
): Promise<ResumePdfResult> {
  if (bytes.byteLength > MAX_RESUME_BYTES) throw new PdfError("too_large");
  // Cheap signature check so obvious non-PDFs never start a parser worker.
  // Successful parsing below is what actually proves the file is a readable PDF.
  if (!Buffer.from(bytes.subarray(0, 1024)).includes("%PDF-")) throw new PdfError("invalid_pdf");
  // The extractor rejects more than maxPages with "too_many_pages" before reading text.
  const extraction = await extractor.extract(bytes, { maxPages: MAX_RESUME_PAGES, signal: options.signal });
  const hasUsableText = extraction.nonWhitespaceChars >= MIN_RESUME_CHARACTERS
    && extraction.pages.every((page) => page.nonWhitespaceChars > 0);
  if (!hasUsableText) {
    const { pageCount, nonWhitespaceChars } = extraction;
    return { textStatus: "unavailable", pageCount, nonWhitespaceChars };
  }
  return { textStatus: "available", extraction };
}
