import { deflateSync } from "node:zlib";

export const resumeLines = [
  "Alex Example - Software Engineer",
  "Built a fictional application tracker with TypeScript and PostgreSQL.",
  "Designed accessible interfaces and maintained clear technical documentation.",
  "Education: Example University, Computer Engineering. Skills: SQL, Node.js, React.",
];

interface TextRun { text: string; x?: number; y?: number }
interface Page { runs: TextRun[]; image?: boolean }
interface Options { size?: number; compressed?: boolean }

export function textPage(lines: string[] = resumeLines, x = 54): Page {
  return { runs: lines.map((text, i) => ({ text, x, y: 740 - i * 22 })) };
}

// Small real PDFs with correct objects/xref, no external fixture library or personal data.
export function makePdf(pages: Page[] = [textPage()], options: Options = {}): Buffer {
  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => { objects.push(Buffer.from(value)); return objects.length; };
  const stream = (bytes: Buffer, extra = "") => {
    if (options.compressed) { bytes = deflateSync(bytes); extra += " /Filter /FlateDecode"; }
    return add(Buffer.concat([
      Buffer.from(`<< /Length ${bytes.length}${extra} >>\nstream\n`), bytes, Buffer.from("\nendstream"),
    ]));
  };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // Filled after the page object IDs are known.
  const characters = [...new Set(pages.flatMap((page) => page.runs.flatMap((run) => [...run.text])))];
  let nextCode = 128;
  const codes = new Map(characters.map((character) => [character,
    character.codePointAt(0)! < 128 ? character.charCodeAt(0) : nextCode++,
  ]));
  if (nextCode > 256) throw new Error("Fixture has too many distinct non-ASCII characters.");
  const unicodeHex = (text: string) => Buffer.from(text, "utf16le").swap16().toString("hex");
  const cmap = stream(Buffer.from([
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /FixtureUnicode def /CMapType 2 def",
    "1 begincodespacerange <00> <FF> endcodespacerange",
    `${codes.size} beginbfchar`,
    ...[...codes].map(([character, code]) => `<${code.toString(16).padStart(2, "0")}> <${unicodeHex(character)}>`),
    "endbfchar endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n")));
  const font = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode ${cmap} 0 R >>`);
  const pageIds: number[] = [];
  for (const page of pages) {
    const image = page.image ? stream(Buffer.from([50, 100, 200]),
      " /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8") : undefined;
    const commands = page.runs.map(({ text, x = 54, y = 740 }) => {
      const encoded = Buffer.from([...text].map((character) => codes.get(character)!)).toString("hex");
      return `BT /F1 11 Tf 1 0 0 1 ${x} ${y} Tm <${encoded}> Tj ET`;
    });
    if (image) commands.push("q 100 0 0 100 50 500 cm /Im1 Do Q");
    const content = stream(Buffer.from(commands.join("\n")));
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> ${image ? `/XObject << /Im1 ${image} 0 R >>` : ""} >> /Contents ${content} 0 R >>`));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let length = parts[0].length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    parts.push(part);
    length += part.length;
  });
  const xref = length;
  parts.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\n`));
  const tail = Buffer.from(`startxref\n${xref}\n%%EOF\n`);
  const base = Buffer.concat(parts);
  const padding = options.size === undefined ? 0 : options.size - base.length - tail.length;
  if (padding < 0) throw new Error("Requested fixture size is smaller than the PDF.");
  return Buffer.concat([base, Buffer.alloc(padding, 32), tail]);
}
