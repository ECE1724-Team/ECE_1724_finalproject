import assert from "node:assert/strict";
import { test } from "node:test";
import { createPdfExtractor } from "../../src/integrations/pdf/extractor.js";
import { countNonWhitespace } from "../../src/integrations/pdf/types.js";
import { MAX_RESUME_BYTES, validateResumePdf } from "../../src/modules/resumes/pdf-policy.js";
import { makePasswordProtectedPdf, makePdf, makeSplitThresholdPdf, resumeLines, textPage } from "../fixtures/pdf.js";

const extractor = createPdfExtractor();
const validate = (bytes: Uint8Array) => validateResumePdf(bytes, extractor);
// Most cases expect usable text; this returns the extraction or fails the test.
async function extractText(bytes: Uint8Array) {
  const result = await validate(bytes);
  assert.equal(result.textStatus, "available");
  return result.extraction;
}

test("one and two pages: stable readable text, evidence, and unchanged original bytes", async () => {
  for (const count of [1, 2]) {
    const bytes = makePdf(Array.from({ length: count }, () => textPage()));
    const original = Buffer.from(bytes);
    const result = await extractText(bytes);
    assert.equal(result.pageCount, count);
    assert.equal(result.pages.length, count);
    assert.equal(result.pages[0].text, resumeLines.join("\n"));
    assert.equal(result.text, result.pages.map((page) => page.text).join("\n\n"));
    assert.equal(result.nonWhitespaceChars, countNonWhitespace(result.text));
    assert.deepEqual(await extractText(bytes), result);
    assert.deepEqual(bytes, original);
  }
});

test("two columns preserve authored reading order and words", async () => {
  const left = textPage(["EXPERIENCE", "Built reliable fictional services.", "Maintained clear documentation."]);
  const right = textPage(["EDUCATION", "Example University engineering degree.", "SKILLS: TypeScript, SQL, React."], 330);
  const result = await extractText(makePdf([{ runs: [...left.runs, ...right.runs] }]));
  assert.equal(result.text, [...left.runs, ...right.runs].map((run) => run.text).join("\n"));
});

test("100 Unicode code points have usable text; 99 do not; whitespace does not count", async () => {
  assert.equal(countNonWhitespace("A \t\n中🚀"), 3);
  for (const character of ["A", "中", "🚀"]) {
    const accepted = await extractText(makePdf([textPage([character.repeat(50), character.repeat(50)])]));
    assert.equal(accepted.nonWhitespaceChars, 100);
    assert.deepEqual(await validate(makePdf([textPage([character.repeat(49), character.repeat(50)])])), {
      textStatus: "unavailable", pageCount: 1, nonWhitespaceChars: 99,
    });
  }
});

test("blank and image-only pages are accepted without text, and no partial text is returned", async () => {
  for (const pages of [
    [textPage(), { runs: [] }],
    [{ runs: [], image: true }],
    [textPage(), { runs: [], image: true }],
  ]) {
    const result = await validate(makePdf(pages));
    assert.equal(result.textStatus, "unavailable");
    assert.equal(result.pageCount, pages.length);
    assert.equal("extraction" in result, false);
  }
});

test("99 characters on page one plus one on page two make usable text", async () => {
  const { nonWhitespaceChars, pages } = await extractText(makeSplitThresholdPdf());
  assert.equal(nonWhitespaceChars, 100);
  assert.deepEqual(pages.map(page => page.nonWhitespaceChars), [99, 1]);
});

test("a PDF that requires an open password is rejected by the real parser", async () => {
  await assert.rejects(validate(makePasswordProtectedPdf()), { code: "unreadable_encryption" });
});

test("reject three pages, damaged and renamed non-PDF input", async () => {
  const cases: [Uint8Array, string][] = [
    [makePdf([textPage(), textPage(), textPage()]), "too_many_pages"],
    [Buffer.from("%PDF-1.7\nThis is damaged, not a document."), "invalid_pdf"],
    [Buffer.from("PK\x03\x04renamed-docx.pdf"), "invalid_pdf"],
    [Buffer.alloc(0), "invalid_pdf"],
  ];
  for (const [bytes, code] of cases) await assert.rejects(validate(bytes), { code });
  // A page with text plus a photo still has usable text.
  await extractText(makePdf([{ ...textPage(), image: true }]));
});

test("exact byte boundary is accepted and one byte over is rejected before extraction", async () => {
  await extractText(makePdf([textPage()], { size: MAX_RESUME_BYTES }));
  await assert.rejects(validateResumePdf(makePdf([textPage()], { size: MAX_RESUME_BYTES + 1 }), {
    async extract() { assert.fail("Oversized bytes must never reach the parser."); },
  }), { code: "too_large" });
});

test("compressed PDF streams can be extracted", async () => {
  await extractText(makePdf([textPage()], { compressed: true }));
});

test("cancellation and capacity release the worker slot", async () => {
  const single = createPdfExtractor({ maxConcurrent: 1 });
  const bytes = makePdf();
  const controller = new AbortController();
  const first = validateResumePdf(bytes, single, { signal: controller.signal });
  const cancelled = assert.rejects(first, { code: "cancelled" });
  await assert.rejects(validateResumePdf(bytes, single), { code: "busy" });
  controller.abort();
  await cancelled;
  await validateResumePdf(bytes, single);
  await assert.rejects(validateResumePdf(bytes, single, { signal: controller.signal }), { code: "cancelled" });
});

test("timeout terminates the worker and permits the next attempt", async () => {
  const fastTimeout = createPdfExtractor({ maxConcurrent: 1, timeoutMs: 1 });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(validateResumePdf(makePdf(), fastTimeout), { code: "timeout" });
  }
});
