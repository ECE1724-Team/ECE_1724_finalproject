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
  // Signature is an early filter; successful parsing below is still required.
  if (bytes.byteLength === 0 || !Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-")) {
    throw new PdfError("invalid_pdf");
  }
  const result = await extractor.extract(bytes, { maxPages: MAX_RESUME_PAGES, signal: options.signal });
  if (result.pageCount < 1 || result.pageCount > MAX_RESUME_PAGES) throw new PdfError("too_many_pages");
  if (result.nonWhitespaceChars < MIN_RESUME_CHARACTERS || result.pages.some((page) => page.nonWhitespaceChars === 0)) {
    throw new PdfError("insufficient_text");
  }
  return result;
}
