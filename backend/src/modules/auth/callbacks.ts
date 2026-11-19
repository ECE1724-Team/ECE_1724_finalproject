import { AuthFailure } from "./errors.js";

export function validateCallback(value: unknown, trustedOrigins: readonly string[]): void {
  if (value === undefined || value === "") return;
  if (typeof value !== "string") throw new AuthFailure(400, "VALIDATION_ERROR", "Callback URL must be a string");
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { throw new AuthFailure(403, "INVALID_CALLBACK_URL", "Untrusted callback URL"); }
  if (/[\\\u0000-\u0020\u007f]/.test(value) || /[\\\u0000-\u001f\u007f]/.test(decoded)) throw new AuthFailure(403, "INVALID_CALLBACK_URL", "Untrusted callback URL");
  if (value.startsWith("/") && !value.startsWith("//") && !decoded.startsWith("//")) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !trustedOrigins.includes(url.origin)) throw new Error();
  } catch { throw new AuthFailure(403, "INVALID_CALLBACK_URL", "Untrusted callback URL"); }
}

export function withQuery(value: string, baseUrl: string, key: string, parameter: string): string {
  const url = new URL(value, baseUrl);
  url.searchParams.set(key, parameter);
  return value.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.href;
}
