import { PdfError, type PdfExtraction, type PdfExtractor } from "../../integrations/pdf/types.js";

export const MAX_RESUME_BYTES = 2_097_152;
export const MAX_RESUME_PAGES = 2;
export const MIN_RESUME_CHARACTERS = 100;

export async function validateResumePdf(
  bytes: Uint8Array,
  extractor: PdfExtractor,
  options: { signal?: AbortSignal } = {},
): Promise<PdfExtraction> {
  if (bytes.byteLength > MAX_RESUME_BYTES) throw new PdfError("too_large");
  // Cheap signature check so obvious non-PDFs never start a parser worker.
  // Successful parsing below is what actually proves the file is a readable PDF.
  if (!Buffer.from(bytes.subarray(0, 1024)).includes("%PDF-")) throw new PdfError("invalid_pdf");
  // The extractor rejects more than maxPages with "too_many_pages" before reading text.
  const result = await extractor.extract(bytes, { maxPages: MAX_RESUME_PAGES, signal: options.signal });
  if (result.nonWhitespaceChars < MIN_RESUME_CHARACTERS || result.pages.some((page) => page.nonWhitespaceChars === 0)) {
    throw new PdfError("insufficient_text");
  }
  return result;
}
