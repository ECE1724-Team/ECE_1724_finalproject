import { createApp } from "./app.js";
import { loadEnvironment } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { Database } from "./db/transaction.js";
import { createSmtpEmailSender } from "./integrations/email/smtp.js";
import { createAuthentication } from "./modules/auth/auth.js";

async function main() {
  const environment = loadEnvironment();
  const pool = createPool(environment.databaseUrl);
  const database = new Database(pool);
  try {
    const result = await pool.query<{ ready: boolean }>(`SELECT
      to_regclass('public.auth_user') IS NOT NULL AND
      to_regclass('public.auth_account') IS NOT NULL AND
      to_regclass('public.auth_session') IS NOT NULL AND
      to_regclass('public.auth_verification') IS NOT NULL AND
      to_regclass('public.auth_credential_state') IS NOT NULL AND
      to_regclass('public.auth_rate_limit') IS NOT NULL AND
      to_regclass('public.auth_email_rate_limit') IS NOT NULL AS ready`);
    if (!result.rows[0]?.ready) throw new Error("Authentication schema is missing; run npm run migrate first");
  } catch (error) { await pool.end(); throw error; }
  const authentication = createAuthentication({ database, config: environment.auth, emailSender: createSmtpEmailSender(environment.smtp) });
  const app = createApp({ authentication, database, environment });
  const server = app.listen(environment.port, () => { console.log(`JobFlow API listening on port ${environment.port}`); });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void authentication.close().then(() => pool.end()).catch(() => { console.error("Shutdown failed"); process.exitCode = 1; });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch(error => {
  // Configuration errors identify keys, not values; connection errors may
  // contain credentials, so do not print arbitrary error objects here.
  console.error(error instanceof Error && /^(Authentication schema|[A-Z_]+ |Invalid [A-Z_]+|Production authentication|SameSite=None)/.test(error.message) ? error.message : "Backend startup failed; check database and configuration");
  process.exitCode = 1;
});
