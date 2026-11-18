/** The service cannot finish safely right now (e.g. the database is unreachable). Maps to HTTP 503. */
export class ServiceUnavailableError extends Error {
  constructor(message = "The service is temporarily unavailable. Please try again.") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

// pg sets `code` to a five-character SQLSTATE when PostgreSQL itself reported the error.
function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/**
 * PostgreSQL answered and the statement failed, so nothing was written.
 * Class 08 (connection exception) is excluded: the outcome may be unknown.
 */
export function isDefiniteDbFailure(error: unknown): boolean {
  const state = sqlState(error);
  return state !== undefined && !state.startsWith("08");
}

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

/** The database could not be reached or is shutting down, rather than a bug or a bad query. */
export function isDbUnavailable(error: unknown): boolean {
  const state = sqlState(error);
  if (state) return state.startsWith("08") || state.startsWith("53") || state.startsWith("57P");
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : "";
  // Messages pg uses for a dropped connection or a pool connect timeout.
  return /Connection terminated|timeout exceeded when trying to connect/i.test(message);
}
