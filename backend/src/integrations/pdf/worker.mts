import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api.js";
import { countNonWhitespace, PdfError, type PdfPageText, type PdfWorkerResult } from "./types.js";

function pageText(items: (TextItem | TextMarkedContent)[]): string {
  let text = "";
  let previous: TextItem | undefined;
  for (const item of items) {
    if (!("str" in item)) continue;
    if (previous && text && !/\s$/u.test(text) && !/^\s/u.test(item.str)) {
      const height = Math.max(previous.height, item.height, 1);
      const lineChanged = Math.abs(item.transform[5] - previous.transform[5]) > height * 0.5;
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      if (lineChanged || gap > height * 2) text += "\n";
      else if (gap > height * 0.15) text += " ";
    }
    text += item.str;
    if (item.hasEOL) text += "\n";
    previous = item;
  }
  // Preserve parser order and line boundaries; normalize whitespace only.
  return text.replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extract(): Promise<PdfWorkerResult> {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  const { bytes, maxPages } = workerData as { bytes: Uint8Array; maxPages: number };
  const task = getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: true,
    verbosity: 0,
    useWorkerFetch: false,
    cMapUrl: join(root, "cmaps") + sep,
    standardFontDataUrl: join(root, "standard_fonts") + sep,
    wasmUrl: join(root, "wasm") + sep,
  });
  try {
    const document = await task.promise;
    if (document.numPages < 1) throw new PdfError("invalid_pdf");
    if (document.numPages > maxPages) throw new PdfError("too_many_pages");
    const pages: PdfPageText[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ disableNormalization: true });
        const text = pageText(content.items);
        pages.push({ pageNumber, text, nonWhitespaceChars: countNonWhitespace(text) });
      } finally {
        page.cleanup();
      }
    }
    return { ok: true, result: {
      text: pages.map((page) => page.text).join("\n\n"),
      pageCount: document.numPages,
      nonWhitespaceChars: pages.reduce((total, page) => total + page.nonWhitespaceChars, 0),
      pages,
    } };
  } finally {
    await task.destroy();
  }
}

try {
  parentPort!.postMessage(await extract());
} catch (error) {
  const name = error instanceof Error ? error.name : "";
  const code = error instanceof PdfError ? error.code
    : name === "PasswordException" ? "unreadable_encryption"
    : name === "InvalidPDFException" || name === "FormatError" ? "invalid_pdf"
    : "processing_failed";
  parentPort!.postMessage({ ok: false, code } satisfies PdfWorkerResult);
}
