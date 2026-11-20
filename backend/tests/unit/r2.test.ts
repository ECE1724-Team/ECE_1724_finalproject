import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import {
  PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, type S3Client,
} from "@aws-sdk/client-s3";
import { createObjectKey, R2Storage } from "../../src/integrations/object-storage/r2.js";
import { makePdf } from "../fixtures/pdf.js";

type Command = PutObjectCommand | GetObjectCommand | HeadObjectCommand | DeleteObjectCommand;
function storageWith(send: (command: Command, signal: AbortSignal) => Promise<unknown>, timeoutMs = 1000) {
  const client = {
    send: ((command: Command, options: { abortSignal: AbortSignal }) =>
      send(command, options.abortSignal)) as S3Client["send"],
    destroy() {},
  };
  return new R2Storage(client, "fictional-bucket", timeoutMs);
}
const serviceError = (name: string, status: number) => ({ name, $metadata: { httpStatusCode: status } });

test("fake S3 round trip uses private immutable PDF objects", async () => {
  const objects = new Map<string, Buffer>();
  const storage = storageWith(async (command) => {
    assert.equal(command.input.Bucket, "fictional-bucket");
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.IfNoneMatch, "*");
      assert.equal(command.input.ContentType, "application/pdf");
      assert.equal(command.input.CacheControl, "private, no-store");
      if (objects.has(key)) throw serviceError("PreconditionFailed", 412);
      const bytes = Buffer.from(command.input.Body as Uint8Array);
      assert.equal(command.input.ContentLength, bytes.length);
      objects.set(key, bytes);
      return {};
    }
    if (command instanceof DeleteObjectCommand) { objects.delete(key); return {}; }
    const bytes = objects.get(key);
    if (!bytes) throw serviceError(command instanceof HeadObjectCommand ? "NotFound" : "NoSuchKey", 404);
    return {
      ContentType: "application/pdf", ContentLength: bytes.length, ETag: '"fictional-etag"',
      ...(command instanceof GetObjectCommand ? { Body: Readable.from([bytes]) } : {}),
    };
  });
  const key = createObjectKey();
  assert.match(key, /^resumes\/[0-9a-f-]{36}\.pdf$/);
  assert.notEqual(key, createObjectKey());
  const bytes = makePdf();
  assert.equal(await storage.read(key), null);
  await storage.putNew(key, bytes);
  await assert.rejects(storage.putNew(key, Buffer.from("replacement")), { code: "conflict" });
  assert.deepEqual((await storage.read(key))?.bytes, bytes);
  assert.deepEqual(await storage.head(key), {
    contentType: "application/pdf", contentLength: bytes.length, etag: '"fictional-etag"',
  });
  await storage.delete(key);
  await storage.delete(key);
  assert.equal(await storage.head(key), null);
});

test("absence stays distinct from denied access, missing bucket, timeout and service failure", async () => {
  for (const [error, code] of [
    [serviceError("AccessDenied", 403), "access_denied"],
    [serviceError("NoSuchBucket", 404), "service_error"],
    [serviceError("InternalError", 500), "service_error"],
    [{ name: "TimeoutError" }, "timeout"],
  ] as const) {
    const storage = storageWith(async () => { throw error; });
    for (const operation of [() => storage.read("key"), () => storage.head("key"), () => storage.delete("key")]) {
      await assert.rejects(operation(), { code });
    }
  }
  const missing = storageWith(async () => { throw serviceError("NoSuchKey", 404); });
  assert.equal(await missing.read("key"), null);
  await missing.delete("key");
  await assert.rejects(storageWith(async () => ({})).read("key"), { code: "service_error" });
});

test("request cancellation and deadline reach the SDK", async () => {
  const storage = storageWith(async (_command, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), 20);
  await assert.rejects(storage.head("key"), { code: "timeout" });
  const controller = new AbortController();
  const pending = storage.putNew("key", makePdf(), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "cancelled" });
  await assert.rejects(storage.head("key", { signal: controller.signal }), { code: "cancelled" });
});

test("read stream errors do not become empty or successful PDFs", async () => {
  const storage = storageWith(async () => ({ Body: Readable.from((async function* () {
    yield Buffer.from("partial");
    throw new Error("network failure");
  })()) }));
  await assert.rejects(storage.read("key"), { code: "service_error" });
});

test("cancellation and deadline also stop a stalled body download", async () => {
  for (const cancel of [false, true]) {
    const source = new Readable({ read() {} });
    const storage = storageWith(async () => ({ Body: source }), 20);
    const controller = new AbortController();
    const pending = storage.read("key", { signal: controller.signal });
    if (cancel) setImmediate(() => controller.abort());
    await assert.rejects(pending, { code: cancel ? "cancelled" : "timeout" });
    assert.equal(source.destroyed, true);
  }
});
