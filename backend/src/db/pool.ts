import { Pool } from "pg";

/**
 * Creates the process-wide PostgreSQL pool. Call it once at startup and pass the pool to the
 * modules that need it (Database Design Appendix C.4); no module opens connections on import.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  watchIdleErrors(pool);
  return pool;
}

/**
 * An idle client that loses its connection (for example when PostgreSQL restarts) emits
 * "error" on the pool; without a listener Node treats it as unhandled and exits. The pool
 * already discards that client, so logging is enough. The message never includes the
 * connection string.
 */
export function watchIdleErrors(pool: Pool): void {
  pool.on("error", (error: Error) => {
    console.error("Idle PostgreSQL client error:", (error as { code?: unknown }).code ?? error.name);
  });
}
