import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export const resumeLines = [
  "Alex Example - Software Engineer",
  "Built a fictional application tracker with TypeScript and PostgreSQL.",
  "Designed accessible interfaces and maintained clear technical documentation.",
  "Education: Example University, Computer Engineering. Skills: SQL, Node.js, React.",
];

interface TextRun { text: string; x?: number; y?: number }
interface Page { runs: TextRun[]; image?: boolean }
interface Options { size?: number; password?: string; compressed?: boolean }

export function textPage(lines: string[] = resumeLines, x = 54): Page {
  return { runs: lines.map((text, i) => ({ text, x, y: 740 - i * 22 })) };
}

const passwordPadding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e8022f0ca9fe6453697a", "hex");
const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest();

// Legacy PDF encryption is used ONLY to build fictional password fixtures.
function rc4(key: Uint8Array, bytes: Uint8Array): Buffer {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(bytes.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < bytes.length; n++) {
    i = (i + 1) % 256;
    j = (j + state[i]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
    output[n] = bytes[n] ^ state[(state[i] + state[j]) % 256];
  }
  return output;
}

// Small real PDFs with correct objects/xref, no external fixture library or personal data.
export function makePdf(pages: Page[] = [textPage()], options: Options = {}): Buffer {
  const id = Buffer.alloc(16, 7);
  let fileKey: Buffer | undefined;
  let encryption = "";
  if (options.password !== undefined) {
    const pad = (password: string) => Buffer.concat([Buffer.from(password), passwordPadding]).subarray(0, 32);
    const owner = rc4(md5(pad("fictional-owner")).subarray(0, 5), pad(options.password));
    const permissions = Buffer.alloc(4);
    permissions.writeInt32LE(-4);
    fileKey = md5(Buffer.concat([pad(options.password), owner, permissions, id])).subarray(0, 5);
    const user = rc4(fileKey, passwordPadding);
    encryption = `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`;
  }

  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => { objects.push(Buffer.from(value)); return objects.length; };
  const stream = (bytes: Buffer, extra = "") => {
    const objectId = objects.length + 1;
    if (options.compressed) { bytes = deflateSync(bytes); extra += " /Filter /FlateDecode"; }
    if (fileKey) {
      const suffix = Buffer.alloc(5);
      suffix.writeUIntLE(objectId, 0, 3);
      bytes = rc4(md5(Buffer.concat([fileKey, suffix])).subarray(0, 10), bytes);
    }
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
  const encryptionId = encryption ? add(encryption) : undefined;
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
  parts.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R ${encryptionId ? `/Encrypt ${encryptionId} 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]` : ""} >>\n`));
  const tail = Buffer.from(`startxref\n${xref}\n%%EOF\n`);
  const base = Buffer.concat(parts);
  const padding = options.size === undefined ? 0 : options.size - base.length - tail.length;
  if (padding < 0) throw new Error("Requested fixture size is smaller than the PDF.");
  return Buffer.concat([base, Buffer.alloc(padding, 32), tail]);
}
