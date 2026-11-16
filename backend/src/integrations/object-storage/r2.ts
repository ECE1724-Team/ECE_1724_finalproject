import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
  type GetObjectCommandOutput, type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  StorageError, type ObjectMetadata, type ObjectStorage,
  type StoredObject, type StorageRequestOptions,
} from "./types.js";

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Per-operation deadline, including SDK retries and reading the response body.
const REQUEST_TIMEOUT_MS = 30_000;

export function createObjectKey(): string {
  return `resumes/${randomUUID()}.pdf`;
}

type ServiceError = { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };

function isMissingKey(error: unknown): boolean {
  const { name, $metadata } = (error ?? {}) as ServiceError;
  // A missing bucket is a configuration failure, not an absent resume.
  if (name === "NoSuchBucket") return false;
  // HEAD responses have no body, so a missing key there is only a bare 404.
  return name === "NoSuchKey" || $metadata?.httpStatusCode === 404;
}

function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const { name, code, $metadata } = (error ?? {}) as ServiceError;
  const status = $metadata?.httpStatusCode;
  if (status === 412 || name === "PreconditionFailed" || name === "ConditionalRequestConflict") {
    return new StorageError("conflict");
  }
  if (status === 401 || status === 403) return new StorageError("access_denied");
  if (name === "TimeoutError" || name === "RequestTimeout" || code === "ETIMEDOUT") {
    return new StorageError("timeout");
  }
  return new StorageError("service_error");
}

function metadata(result: GetObjectCommandOutput | HeadObjectCommandOutput): ObjectMetadata {
  return { contentType: result.ContentType, contentLength: result.ContentLength, etag: result.ETag };
}

// SDK types stay in this adapter. Tests may supply a fake client.
export class R2Storage implements ObjectStorage {
  constructor(
    private readonly client: Pick<S3Client, "send" | "destroy">,
    private readonly bucket: string,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  // Runs one operation under the caller's signal plus the deadline and converts every
  // failure to a StorageError. With missingIsNull, an absent key resolves to null.
  private async request<T>(
    options: StorageRequestOptions,
    missingIsNull: boolean,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | null> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    try {
      signal.throwIfAborted();
      return await operation(signal);
    } catch (error) {
      if (deadline.signal.aborted) throw new StorageError("timeout");
      if (signal.aborted) throw new StorageError("cancelled");
      if (missingIsNull && isMissingKey(error)) return null;
      throw toStorageError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async putNew(key: string, bytes: Uint8Array, options: StorageRequestOptions = {}): Promise<void> {
    await this.request(options, false, (signal) => this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: bytes,
      ContentType: "application/pdf", ContentLength: bytes.byteLength,
      // IfNoneMatch makes R2 reject the write instead of overwriting an existing key.
      CacheControl: "private, no-store", IfNoneMatch: "*",
    }), { abortSignal: signal }));
  }

  async read(key: string, options: StorageRequestOptions = {}): Promise<StoredObject | null> {
    return this.request(options, true, async (signal) => {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket, Key: key,
      }), { abortSignal: signal });
      const body = result.Body;
      if (!(body instanceof Readable)) throw new StorageError("service_error");
      // Let the deadline or cancellation also stop a stalled body download.
      const stop = () => body.destroy();
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      try {
        return { ...metadata(result), bytes: await buffer(body) };
      } finally {
        signal.removeEventListener("abort", stop);
      }
    });
  }

  async head(key: string, options: StorageRequestOptions = {}): Promise<ObjectMetadata | null> {
    return this.request(options, true, async (signal) => metadata(await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal },
    )));
  }

  // Deleting an already absent key succeeds, so cleanup can be retried safely.
  async delete(key: string, options: StorageRequestOptions = {}): Promise<void> {
    await this.request(options, true, (signal) => this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal },
    ));
  }

  // Releases the SDK client's sockets on application shutdown.
  close(): void {
    this.client.destroy();
  }
}

export function createR2Storage(config: R2Config): R2Storage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: "auto", // R2 has no regions; Cloudflare's SDK examples use "auto".
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Send checksums only when an operation requires them, as recommended for R2.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return new R2Storage(client, config.bucket);
}
