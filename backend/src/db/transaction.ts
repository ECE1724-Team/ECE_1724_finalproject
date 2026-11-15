import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

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
