import express, { Router, type ErrorRequestHandler } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import type { Environment } from "./config/env.js";
import type { Database } from "./db/transaction.js";
import { requireVerifiedUser } from "./http/authorization.js";
import type { Authentication } from "./modules/auth/auth.js";

interface AppOptions {
  authentication: Authentication;
  database: Database;
  environment: Pick<Environment, "auth" | "trustProxyHops">;
  /** Future business modules mount here behind verified-session protection. */
  businessRouter?: Router;
}

export function createApp({ authentication, environment, businessRouter = Router() }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", environment.trustProxyHops);
  app.use(cors({
    origin: (origin, done) => done(null, !origin || environment.auth.trustedOrigins.includes(origin)),
    credentials: true,
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
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
    if (status === 400 || status === 413) {
      res.status(status).json({ error: { code: "BAD_REQUEST", message: "Invalid request body" } });
      return;
    }
    console.error("HTTP operation failed");
    res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "The request could not be completed" } });
  };
  app.use(errors);
  return app;
}
