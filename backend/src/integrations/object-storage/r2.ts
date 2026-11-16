import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
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
  region: string;
  maxAttempts: number;
  requestTimeoutMs: number;
}

export function createObjectKey(): string {
  return `resumes/${randomUUID()}.pdf`;
}

type ServiceError = { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };

function isMissing(error: unknown, head = false): boolean {
  const { name, $metadata } = (error ?? {}) as ServiceError;
  // A missing bucket is a configuration failure, not an absent resume.
  return name === "NoSuchKey" || (head && name !== "NoSuchBucket" && $metadata?.httpStatusCode === 404);
}

function storageError(error: unknown, signal: AbortSignal): StorageError {
  if (signal.aborted && signal.reason instanceof StorageError) return signal.reason;
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

function requestScope(timeoutMs: number, caller?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new StorageError("cancelled"));
  if (caller?.aborted) cancel();
  else caller?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new StorageError("timeout")), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    },
  };
}

function metadata(result: GetObjectCommandOutput | HeadObjectCommandOutput): ObjectMetadata {
  return { contentType: result.ContentType, contentLength: result.ContentLength, etag: result.ETag };
}

// SDK types stay in this adapter. Tests may supply a fake send implementation.
export class R2Storage implements ObjectStorage {
  constructor(
    private readonly client: Pick<S3Client, "send">,
    private readonly bucket: string,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  private async request<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: StorageRequestOptions,
  ): Promise<T> {
    const scope = requestScope(this.requestTimeoutMs, options.signal);
    try {
      scope.signal.throwIfAborted();
      return await operation(scope.signal);
    } catch (error) {
      throw storageError(error, scope.signal);
    } finally {
      scope.dispose();
    }
  }

  async putNew(key: string, bytes: Uint8Array, options: StorageRequestOptions = {}): Promise<void> {
    await this.request(async (signal) => {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: bytes,
        ContentType: "application/pdf", ContentLength: bytes.byteLength,
        CacheControl: "private, no-store", IfNoneMatch: "*",
      }), { abortSignal: signal });
    }, options);
  }

  async head(key: string, options: StorageRequestOptions = {}): Promise<ObjectMetadata | null> {
    return this.request(async (signal) => {
      try {
        return metadata(await this.client.send(new HeadObjectCommand({
          Bucket: this.bucket, Key: key,
        }), { abortSignal: signal }));
      } catch (error) {
        if (!signal.aborted && isMissing(error, true)) return null;
        throw error;
      }
    }, options);
  }

  async delete(key: string, options: StorageRequestOptions = {}): Promise<void> {
    await this.request(async (signal) => {
      try {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
          abortSignal: signal,
        });
      } catch (error) {
        if (signal.aborted || !isMissing(error)) throw error;
      }
    }, options);
  }

  async open(key: string, options: StorageRequestOptions = {}): Promise<StoredObject | null> {
    const scope = requestScope(this.requestTimeoutMs, options.signal);
    try {
      scope.signal.throwIfAborted();
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket, Key: key,
      }), { abortSignal: scope.signal });
      const source = result.Body;
      if (!(source instanceof Readable)) throw new StorageError("service_error");

      // Keep the deadline alive through body consumption, not just response headers.
      // finished attaches an error listener even before the consumer starts reading.
      const completion = finished(source, { cleanup: true });
      const abort = () => source.destroy(storageError(scope.signal.reason, scope.signal));
      scope.signal.addEventListener("abort", abort, { once: true });
      void completion.catch(() => {}).finally(() => {
        scope.dispose();
        scope.signal.removeEventListener("abort", abort);
      });
      if (scope.signal.aborted) abort();
      const body = Readable.from((async function* () {
        try {
          for await (const chunk of source) yield chunk;
        } catch (error) {
          throw storageError(error, scope.signal);
        } finally {
          source.destroy();
        }
      })(), { objectMode: false });
      // Also handle consumers that destroy the returned stream without reading it.
      body.once("close", () => source.destroy());
      return { ...metadata(result), body };
    } catch (error) {
      scope.dispose();
      if (!scope.signal.aborted && isMissing(error)) return null;
      throw storageError(error, scope.signal);
    }
  }
}

export function createR2Storage(config: R2Config): R2Storage & { close(): void } {
  for (const field of ["endpoint", "bucket", "accessKeyId", "secretAccessKey", "region"] as const) {
    if (!config[field]?.trim()) throw new Error(`R2 configuration is missing ${field}.`);
  }
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: config.maxAttempts,
    retryMode: "standard",
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return Object.assign(new R2Storage(client, config.bucket, config.requestTimeoutMs), {
    close: () => client.destroy(),
  });
}
