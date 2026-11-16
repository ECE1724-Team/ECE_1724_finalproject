import type { R2Config } from "../integrations/object-storage/r2.js";

type Environment = Record<string, string | undefined>;

// Read configuration explicitly at startup, never as an import side effect.
export function readR2Config(env: Environment = process.env): R2Config {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required to initialize R2 storage.`);
    return value;
  };
  const endpoint = required("R2_ENDPOINT");
  // URL.canParse avoids echoing a malformed value (which may embed credentials) in the error.
  const url = URL.canParse(endpoint) ? new URL(endpoint) : undefined;
  if (url?.protocol !== "https:" || url.username || url.password) {
    throw new Error("R2_ENDPOINT must be an HTTPS URL without embedded credentials.");
  }
  return {
    endpoint,
    bucket: required("R2_BUCKET_NAME"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  };
}
