import { readDatabaseUrl } from "../db/database-url.mjs";
import type { SmtpEmailConfig } from "../integrations/email/types.js";
import type { R2Config } from "../integrations/object-storage/r2.js";
import { ConfigurationError } from "./errors.js";

export interface AuthConfig {
  baseUrl: string;
  secret: string;
  trustedOrigins: string[];
  sessionLifetimeSeconds: number;
  emailCooldownSeconds: number;
  emailWindowSeconds: number;
  emailMaxPerWindow: number;
  secureCookies: boolean;
  cookieSameSite: "lax" | "strict" | "none";
}

export interface Environment {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  trustProxyHops: number;
  auth: AuthConfig;
  smtp: SmtpEmailConfig;
  r2: R2Config | undefined;
}

const R2_SETTINGS = ["R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;

function integer(value: string | undefined, fallback: number, label: string, min = 1): number {
  const result = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min) throw new ConfigurationError(`${label} must be an integer >= ${min}`);
  return result;
}

function required(env: NodeJS.ProcessEnv, key: string, trim = true): string {
  const value = env[key];
  if (!value?.trim()) throw new ConfigurationError(`${key} is required`);
  return trim ? value.trim() : value;
}

function origin(value: string, key: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("invalid origin");
    return url.origin;
  } catch {
    throw new ConfigurationError(`${key} must be an http(s) origin without a path, credentials, query or fragment`);
  }
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") throw new ConfigurationError("Invalid NODE_ENV");
  const baseUrl = origin(required(env, "BETTER_AUTH_URL"), "BETTER_AUTH_URL");
  const secret = required(env, "BETTER_AUTH_SECRET", false);
  if (secret.length < 32 || /replace|changeme|example-secret/i.test(secret)) throw new ConfigurationError("BETTER_AUTH_SECRET must be a private random value of at least 32 characters");
  // The same rule as createPool() and npm run migrate; its messages never echo the value.
  let databaseUrl: string;
  try { databaseUrl = readDatabaseUrl(env); }
  catch (error) { throw new ConfigurationError(error instanceof Error ? error.message : "DATABASE_URL is invalid"); }
  const trustedOrigins = [...new Set([baseUrl, ...required(env, "AUTH_TRUSTED_ORIGINS").split(",").map(value => origin(value.trim(), "AUTH_TRUSTED_ORIGINS"))])];
  if (nodeEnv === "production" && (baseUrl.startsWith("http:") || trustedOrigins.some(value => value.startsWith("http:")))) throw new ConfigurationError("Production authentication requires HTTPS origins");
  const cookieSameSite = env.AUTH_COOKIE_SAME_SITE ?? "lax";
  if (!["lax", "strict", "none"].includes(cookieSameSite)) throw new ConfigurationError("Invalid AUTH_COOKIE_SAME_SITE");
  const secureCookies = new URL(baseUrl).protocol === "https:";
  if (cookieSameSite === "none" && !secureCookies) throw new ConfigurationError("SameSite=None requires HTTPS");
  if (env.SMTP_SECURE !== undefined && !["true", "false"].includes(env.SMTP_SECURE)) throw new ConfigurationError("SMTP_SECURE must be true or false");
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new ConfigurationError("SMTP_USER and SMTP_PASSWORD must be provided together");
  return {
    nodeEnv,
    port: integer(env.PORT, 3000, "PORT"),
    databaseUrl,
    trustProxyHops: integer(env.TRUST_PROXY_HOPS, 0, "TRUST_PROXY_HOPS", 0),
    auth: {
      baseUrl, secret, trustedOrigins,
      sessionLifetimeSeconds: integer(env.AUTH_SESSION_SECONDS, 604800, "AUTH_SESSION_SECONDS"),
      emailCooldownSeconds: integer(env.AUTH_EMAIL_COOLDOWN_SECONDS, 60, "AUTH_EMAIL_COOLDOWN_SECONDS"),
      emailWindowSeconds: integer(env.AUTH_EMAIL_WINDOW_SECONDS, 900, "AUTH_EMAIL_WINDOW_SECONDS"),
      emailMaxPerWindow: integer(env.AUTH_EMAIL_MAX_PER_WINDOW, 5, "AUTH_EMAIL_MAX_PER_WINDOW"),
      secureCookies,
      cookieSameSite: cookieSameSite as AuthConfig["cookieSameSite"],
    },
    smtp: {
      host: required(env, "SMTP_HOST"),
      port: integer(env.SMTP_PORT, 587, "SMTP_PORT"),
      secure: env.SMTP_SECURE === "true",
      from: required(env, "SMTP_FROM"),
      ...(env.SMTP_USER ? { user: env.SMTP_USER, password: required(env, "SMTP_PASSWORD", false) } : {}),
    },
    r2: nodeEnv === "production" || R2_SETTINGS.some(key => env[key]?.trim()) ? readR2Config(env) : undefined,
  };
}

// Read configuration explicitly at startup, never as an import side effect.
export function readR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const [endpointKey, bucketKey, accessKey, secretKey] = R2_SETTINGS;
  const endpoint = origin(required(env, endpointKey), endpointKey);
  if (!endpoint.startsWith("https:")) {
    throw new ConfigurationError("R2_ENDPOINT must use HTTPS");
  }
  const bucket = required(env, bucketKey);
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new ConfigurationError("R2_BUCKET_NAME must be 3–63 lowercase letters, digits or hyphens, starting and ending with a letter or digit");
  }
  return {
    endpoint, bucket,
    accessKeyId: required(env, accessKey),
    secretAccessKey: required(env, secretKey),
  };
}
