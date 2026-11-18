
import { Pool, type PoolClient } from "pg";
import { readDatabaseUrl } from "./database-url.mjs";

/** The pool, or a client inside a transaction. */
export type Db = Pool | PoolClient;

type Environment = Record<string, string | undefined>;

export function createPool(env: Environment = process.env): Pool {
    const pool = new Pool({
        connectionString: readDatabaseUrl(env),
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });

    pool.on("error", (error: Error) => {
        console.error("Unexpected PostgreSQL pool error:", error);
    });
    return pool;
}
