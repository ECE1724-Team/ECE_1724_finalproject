type Environment = Record<string, string | undefined>;

/** Reads and checks a PostgreSQL URL from `env[name]`. The URL must name its database. */
export function readDatabaseUrl(env: Environment = process.env, name = "DATABASE_URL"): string {
    const connectionString = env[name]?.trim();
    if (!connectionString) {
        throw new Error(`${name} is not configured`);
    }

    const url = URL.parse(connectionString);
    if (!url || !/^postgres(?:ql)?:\/\//.test(connectionString)) {
        throw new Error(`${name} must be a PostgreSQL connection URL`);
    }
    // Without a name, pg silently connects to the database named after the user.
    if (url.pathname.length <= 1) {
        throw new Error(`${name} must name the PostgreSQL database`);
    }

    return connectionString;
}
