import assert from "node:assert/strict";
import { test } from "node:test";
import { readR2Config } from "../../src/config/env.js";
import { createObjectKey, createR2Storage } from "../../src/integrations/object-storage/r2.js";
import { makePdf } from "../fixtures/pdf.js";

const required = ["R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const missing = required.filter((name) => !process.env[name]?.trim());
const skip = process.env.R2_INTEGRATION_TEST !== "1" ? "Set R2_INTEGRATION_TEST=1 for an isolated development bucket."
  : missing.length ? `Missing configuration: ${missing.join(", ")}` : false;

test("real R2: write, collision, read, metadata, delete and absence", { skip }, async () => {
  const storage = createR2Storage(readR2Config());
  const key = `integration-tests/${createObjectKey()}`;
  const bytes = makePdf();
  try {
    await storage.putNew(key, bytes);
    await assert.rejects(storage.putNew(key, bytes), { code: "conflict" });
    assert.deepEqual((await storage.read(key))?.bytes, bytes);
    const metadata = await storage.head(key);
    assert.equal(metadata?.contentType, "application/pdf");
    assert.equal(metadata?.contentLength, bytes.length);
    await storage.delete(key);
    await storage.delete(key);
    assert.equal(await storage.head(key), null);
    assert.equal(await storage.read(key), null);
  } finally {
    // The key is a fresh random UUID, so this can only remove this test's own object.
    await storage.delete(key).finally(() => storage.close());
  }
});
