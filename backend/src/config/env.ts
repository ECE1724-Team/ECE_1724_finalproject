import type { R2Config } from "../integrations/object-storage/r2.js";
import type { PdfExtractorOptions } from "../integrations/pdf/extractor.js";

type Environment = Record<string, string | undefined>;

function positiveInteger(env: Environment, name: string, fallback: number): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) {
    throw new Error(`${name} must be a positive integer no greater than 2147483647.`);
  }
  return number;
}

// Read configuration explicitly at startup, never as an import side effect.
export function readR2Config(env: Environment = process.env): R2Config {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required to initialize R2 storage.`);
    return value;
  };
  const endpoint = required("R2_ENDPOINT");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("R2_ENDPOINT must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("R2_ENDPOINT must be an HTTPS URL without credentials, query or fragment.");
  }
  return {
    endpoint,
    bucket: required("R2_BUCKET_NAME"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    region: env.R2_REGION?.trim() || "auto",
    maxAttempts: positiveInteger(env, "R2_MAX_ATTEMPTS", 3),
    requestTimeoutMs: positiveInteger(env, "R2_REQUEST_TIMEOUT_MS", 30_000),
  };
}

export function readPdfConfig(env: Environment = process.env): PdfExtractorOptions {
  return {
    maxConcurrent: positiveInteger(env, "PDF_MAX_CONCURRENT", 2),
    timeoutMs: positiveInteger(env, "PDF_PARSE_TIMEOUT_MS", 15_000),
    workerMemoryMb: positiveInteger(env, "PDF_WORKER_MEMORY_MB", 256),
  };
}
