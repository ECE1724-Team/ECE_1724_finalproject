type Environment = Record<string, string | undefined>;

export function readDatabaseUrl(env: Environment = process.env): string {
    const connectionString = env.DATABASE_URL?.trim();
    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured");
    }

    const url = URL.parse(connectionString);
    if (!url || !/^postgres(?:ql)?:\/\//.test(connectionString) || (!url.hostname && !url.pathname.slice(1))) {
        throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
    }

    return connectionString;
}
