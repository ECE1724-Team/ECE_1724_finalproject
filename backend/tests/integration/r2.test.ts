import assert from "node:assert/strict";
import { buffer } from "node:stream/consumers";
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
  let created = false;
  try {
    await storage.putNew(key, bytes);
    created = true;
    await assert.rejects(storage.putNew(key, bytes), { code: "conflict" });
    const object = await storage.open(key);
    assert.ok(object);
    assert.deepEqual(await buffer(object.body), bytes);
    const metadata = await storage.head(key);
    assert.equal(metadata?.contentType, "application/pdf");
    assert.equal(metadata?.contentLength, bytes.length);
    await storage.delete(key);
    await storage.delete(key);
    assert.equal(await storage.head(key), null);
    assert.equal(await storage.open(key), null);
  } finally {
    try {
      // Never delete a pre-existing object if the initial conditional write failed.
      if (created) await storage.delete(key);
      else console.error(`R2 write outcome unconfirmed; inspect only this test key if needed: ${key}`);
    } finally {
      storage.close();
    }
  }
});
