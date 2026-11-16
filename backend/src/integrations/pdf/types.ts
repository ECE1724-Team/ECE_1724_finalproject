export interface PdfPageText {
  pageNumber: number;
  text: string;
  nonWhitespaceChars: number;
}

export interface PdfExtraction {
  text: string;
  pageCount: number;
  nonWhitespaceChars: number;
  pages: PdfPageText[];
}

export interface PdfExtractor {
  extract(bytes: Uint8Array, options: { maxPages: number; signal?: AbortSignal }): Promise<PdfExtraction>;
}

export type PdfErrorCode =
  | "invalid_pdf" | "too_large" | "too_many_pages" | "insufficient_text"
  | "unreadable_encryption" | "processing_failed" | "timeout" | "cancelled" | "busy";

const messages: Record<PdfErrorCode, string> = {
  invalid_pdf: "The file is not a readable PDF. Export a new text-based PDF.",
  too_large: "The PDF must be no larger than 2097152 bytes (2 MiB).",
  too_many_pages: "The PDF must contain one or two pages.",
  insufficient_text: "The PDF needs text on every page and at least 100 non-whitespace characters in total.",
  unreadable_encryption: "The PDF requires a password. Export a readable text-based PDF.",
  processing_failed: "PDF processing failed. Please try again.",
  timeout: "PDF processing timed out. Please try again.",
  cancelled: "PDF processing was cancelled.",
  busy: "PDF processing is busy. Please try again shortly.",
};

export class PdfError extends Error {
  constructor(public readonly code: PdfErrorCode) {
    super(messages[code]);
    this.name = "PdfError";
  }
}

export type PdfWorkerResult =
  | { ok: true; result: PdfExtraction }
  | { ok: false; code: PdfErrorCode };

// Count Unicode code points, not UTF-16 code units or UTF-8 bytes.
export function countNonWhitespace(text: string): number {
  return [...text.replace(/\s/gu, "")].length;
}
