import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../src/db/transaction.js";

/** Run the competing queries to completion after the lock-holder commits or rolls back. */
export async function withLockHolder<T>(pool: Pool, run: (
  client: PoolClient, pid: number, start: <Result>(query: Promise<Result>) => Promise<Result>,
) => Promise<T>): Promise<T> {
  const queries: Promise<unknown>[] = [];
  const start = <Result>(query: Promise<Result>): Promise<Result> => {
    queries.push(query);
    void query.catch(() => {}); // The test awaits the result once the holder's locks are released.
    return query;
  };

  try {
    return await withTransaction(pool, async (client) => {
      const { rows: [{ pid }] } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      return run(client, pid, start);
    });
  } finally {
    await Promise.allSettled(queries);
  }
}

export async function waitForBlockedQuery(pool: Pool, blocker: number, sqlFragment: string): Promise<number> {
  const deadline = performance.now() + 4_000;
  do {
    const { rows: [waiting] } = await pool.query<{ pid: number }>(`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid)) AND strpos(query, $2) > 0
    `, [blocker, sqlFragment]);
    if (waiting) return waiting.pid;
    await delay(10);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${sqlFragment} to block on PostgreSQL backend ${blocker}`);
}
