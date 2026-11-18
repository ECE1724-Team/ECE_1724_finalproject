import express, { Router, type ErrorRequestHandler } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import type { Environment } from "./config/env.js";
import type { Database } from "./db/transaction.js";
import { requireVerifiedUser } from "./http/authorization.js";
import type { Authentication } from "./modules/auth/auth.js";
// Shared PostgreSQL outage test; it lives with the resume module, which introduced it.
import { UNAVAILABLE_MESSAGE, isDbUnavailable } from "./modules/resumes/errors.js";

interface AppOptions {
  authentication: Authentication;
  database: Database;
  environment: Pick<Environment, "auth" | "trustProxyHops">;
  /**
   * Business routes, mounted at /api/v1 behind the origin check and `requireVerifiedUser`,
   * so every handler sees `res.locals.auth`. Example:
   * `router.use("/resumes", createResumeRouter({ service, authenticate: requireAuthContext }))`.
   */
  businessRouter?: Router;
}

// Response headers the cross-origin frontend may read: Retry-After on 429/503, Location on
// 201, Content-Disposition (file name) on resume downloads.
const EXPOSED_HEADERS = ["Retry-After", "Location", "Content-Disposition"];

export function createApp({ authentication, environment, businessRouter = Router() }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", environment.trustProxyHops);
  app.use(cors({
    origin: (origin, done) => done(null, !origin || environment.auth.trustedOrigins.includes(origin)),
    credentials: true,
    exposedHeaders: EXPOSED_HEADERS,
  }));
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });

  // This internal header is overwritten, not accepted from the caller/proxy.
  const nodeAuth = toNodeHandler(authentication.handler);
  app.all("/api/auth/{*authPath}", async (req, res, next) => {
    req.headers["x-jobflow-client-ip"] = req.ip ?? req.socket.remoteAddress ?? "";
    try { await nodeAuth(req, res); } catch (error) { next(error); }
  });
  // Better Auth must receive the original request stream before body parsing.
  app.use(express.json({ limit: "1mb" }));
  // Cookie-authenticated writes must come from a trusted page (CSRF protection). Browsers
  // send Origin on every cross-origin request and on same-origin POST/PUT/DELETE.
  app.use("/api/v1", (req, res, next) => {
    const origin = req.get("origin");
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (unsafe && (origin ? !environment.auth.trustedOrigins.includes(origin) : req.get("sec-fetch-site") === "cross-site")) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Untrusted request origin" } });
      return;
    }
    next();
  }, requireVerifiedUser(authentication), businessRouter);
  app.use((_req, res) => { res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } }); });

  const errors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    // Only express.json() errors carry a body-parser `type`; their status is 400 or 413.
    if (isBodyParserError(error)) {
      if (error.status === 413) {
        res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large" } });
      } else {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid request body" } });
      }
      return;
    }
    // Neither the message nor the stack is logged: driver errors can quote connection details.
    console.error("HTTP request failed:", describe(error));
    if (isDbUnavailable(error)) {
      res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: UNAVAILABLE_MESSAGE } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
  };
  app.use(errors);
  return app;
}

function isBodyParserError(error: unknown): error is { status: number; type: string } {
  if (typeof error !== "object" || error === null) return false;
  const { status, type } = error as { status?: unknown; type?: unknown };
  return typeof type === "string" && typeof status === "number" && status >= 400 && status < 500;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} (${code})` : error.name;
}
