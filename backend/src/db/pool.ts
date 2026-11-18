
import { Pool } from "pg";

type Environment = Record<string, string | undefined>;

export function createPool(env: Environment = process.env): Pool {
    const connectionString = env.DATABASE_URL?.trim();
    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured");
    }

    const url = URL.parse(connectionString);
    if (!url || !/^postgres(?:ql)?:\/\//.test(connectionString) || (!url.hostname && !url.pathname.slice(1))) {
        throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
    }

    const pool = new Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });

    pool.on("error", (error: Error) => {
        console.error("Unexpected PostgreSQL pool error:", error);
    });
    return pool;
}
