import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * Runs `callback` in its own transaction on a client from `pool`: COMMIT when it resolves,
 * ROLLBACK when it throws. For business repository workflows that must commit atomically
 * (Database Design Appendix C.4). Authentication code uses `Database` below instead.
 */
export async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard: true | undefined;
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    const commit = await client.query("COMMIT");
    // PostgreSQL answers COMMIT of an aborted transaction (a failed statement whose error the
    // callback caught) with ROLLBACK. That is not a durable success.
    if (commit.command !== "COMMIT") throw new Error("PostgreSQL rolled back an aborted transaction");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Do not return a connection in an unknown state to the pool.
      discard = true;
      console.error("Transaction rollback failed:", rollbackError);
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

interface TransactionContext {
  client: PoolClient;
  closed: boolean;
  failed: boolean;
  failure?: unknown;
}

/** Shares one PostgreSQL transaction with native auth and application queries. */
export class Database {
  private readonly transactions = new AsyncLocalStorage<TransactionContext>();

  constructor(readonly pool: Pool) {}

  currentClient(): PoolClient | undefined {
    const context = this.transactions.getStore();
    return context && !context.closed ? context.client : undefined;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const context = this.transactions.getStore();
    if (context?.closed) {
      throw new Error("Cannot query through a transaction that has already finished");
    }
    try {
      return await (context?.client ?? this.pool).query<T>(text, values);
    } catch (error) {
      if (context) {
        context.failed = true;
        context.failure ??= error;
      }
      throw error;
    }
  }

  /**
   * Nested work joins the existing transaction; only the outermost caller owns
   * COMMIT/ROLLBACK. A failed nested call makes the entire transaction rollback
   * even if a library catches its exception. No savepoint or partial commit is
   * implied by nesting.
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const existing = this.transactions.getStore();
    if (existing) {
      if (existing.closed) {
        throw new Error("Cannot join a transaction that has already finished");
      }
      try {
        return await work(existing.client);
      } catch (error) {
        existing.failed = true;
        existing.failure ??= error;
        throw error;
      }
    }

    const client = await this.pool.connect();
    const context: TransactionContext = { client, closed: false, failed: false };
    let begun = false;
    let releaseError: Error | undefined;
    try {
      await client.query("BEGIN");
      begun = true;
      return await this.transactions.run(context, async () => {
        const result = await work(client);
        if (context.failed) throw context.failure;
        const commit = await client.query("COMMIT");
        // PostgreSQL answers an attempted COMMIT of an aborted transaction with
        // ROLLBACK. Do not report a durable success in that case.
        if (commit.command !== "COMMIT") {
          throw new Error("PostgreSQL rolled back an aborted transaction");
        }
        begun = false;
        return result;
      });
    } catch (error) {
      if (begun) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          releaseError = rollbackError instanceof Error
            ? rollbackError
            : new Error("PostgreSQL rollback failed", { cause: rollbackError });
        }
      } else if (error instanceof Error) {
        releaseError = error;
      }
      throw error;
    } finally {
      context.closed = true;
      client.release(releaseError);
    }
  }
}
