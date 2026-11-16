export interface StorageRequestOptions {
  signal?: AbortSignal;
}

export interface ObjectMetadata {
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
}

// Resume PDFs are capped at 2 MiB, so reads return the whole file instead of a stream.
export interface StoredObject extends ObjectMetadata {
  bytes: Uint8Array;
}

// Keys come from the server/database, never from an upload form.
export interface ObjectStorage {
  putNew(key: string, bytes: Uint8Array, options?: StorageRequestOptions): Promise<void>;
  read(key: string, options?: StorageRequestOptions): Promise<StoredObject | null>;
  head(key: string, options?: StorageRequestOptions): Promise<ObjectMetadata | null>;
  delete(key: string, options?: StorageRequestOptions): Promise<void>;
}

export type StorageErrorCode = "conflict" | "access_denied" | "timeout" | "cancelled" | "service_error";

export class StorageError extends Error {
  constructor(public readonly code: StorageErrorCode) {
    super(`Object storage operation failed: ${code}.`);
    this.name = "StorageError";
  }
}
