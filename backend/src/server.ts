import { once } from "node:events";
import { createServer } from "node:http";
import { Router } from "express";
import { createApp } from "./app.js";
import { loadEnvironment } from "./config/env.js";
import { ConfigurationError } from "./config/errors.js";
import { createPool } from "./db/pool.js";
import { Database } from "./db/transaction.js";
import { createSmtpEmailSender } from "./integrations/email/smtp.js";
import { createPostgresApplicationService } from "./modules/applications/postgres-module.js";
import { createApplicationRouter } from "./modules/applications/routes.js";
import { createR2Storage } from "./integrations/object-storage/r2.js";
import { createPdfExtractor } from "./integrations/pdf/extractor.js";
import { createAuthentication } from "./modules/auth/auth.js";
import { assertAuthSchema } from "./modules/auth/schema.js";
import { mountPostgresResumeRoutes } from "./modules/resumes/postgres-routes.js";

async function main() {
  const environment = loadEnvironment();
  const databaseEnv = { DATABASE_URL: environment.databaseUrl };
  // Both pools are created here and passed in (Database Design C.4). The second one keeps the
  // auth rate-limit counters outside the request transactions, so a rolled-back sign-in still
  // counts and account transactions cannot starve the limiter of connections.
  const pool = createPool(databaseEnv);
  const rateLimitPool = createPool(databaseEnv);
  const closePools = () => Promise.all([pool.end(), rateLimitPool.end()]);
  try {
    await assertAuthSchema(pool);
  } catch (error) {
    await closePools();
    throw error;
  }

  const database = new Database(pool);
  const authentication = createAuthentication({
    database, rateLimitPool, config: environment.auth, emailSender: createSmtpEmailSender(environment.smtp),
  });

  // Business routes sit behind createApp's /api/v1 origin check and requireVerifiedUser.
  const businessRouter = Router();
  businessRouter.use("/applications", createApplicationRouter({ service: createPostgresApplicationService(pool) }));
  const storage = environment.r2 && createR2Storage(environment.r2);
  const startResumeWorker = storage && mountPostgresResumeRoutes(businessRouter, { pool, storage, pdf: createPdfExtractor() });
  if (!storage) console.warn("R2 settings are empty. Resume routes and cleanup worker are disabled.");

  const app = createApp({ authentication, database, environment, businessRouter });
  const server = createServer(app);
  try {
    server.listen(environment.port);
    await once(server, "listening");
  } catch (error) {
    storage?.close();
    await closePools();
    throw error;
  }
  const worker = startResumeWorker?.();
  console.log(`JobFlow API listening on port ${environment.port}`);

  const closeServices = async () => {
    await worker?.stop();
    storage?.close();
    try {
      await authentication.close();
    } finally {
      await closePools();
    }
  };
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    // Drain HTTP first so requests can finish using storage and enqueue cleanup work.
    server.close(() => {
      void closeServices().catch(() => {
        console.error("Shutdown failed");
        process.exitCode = 1;
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  // Configuration errors name the setting, never its value. Anything else (for example a
  // connection error) may quote credentials, so it is not printed.
  console.error(error instanceof ConfigurationError ? error.message : "Backend startup failed; check database and configuration");
  process.exitCode = 1;
});
