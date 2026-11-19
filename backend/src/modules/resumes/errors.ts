import { DatabaseError } from "pg";

export const UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Please try again.";

/** The service cannot finish safely right now (e.g. the database is unreachable). Maps to HTTP 503. */
export class ServiceUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "ServiceUnavailableError";
  }
}

// pg throws DatabaseError only for an error message sent by PostgreSQL; its `code` is the SQLSTATE.
// Socket errors also carry a `code` (EPIPE, ECONNRESET...), so the class is the reliable test.
function sqlState(error: unknown): string | undefined {
  return error instanceof DatabaseError ? error.code : undefined;
}

/**
 * PostgreSQL answered and the statement failed, so nothing was written.
 * A connection exception, a fatal session error, or statement_completion_unknown
 * can leave the outcome unknown. PostgreSQL can localize the severity of a shutdown.
 */
export function isDefiniteDbFailure(error: unknown): boolean {
  if (!(error instanceof DatabaseError)) return false;
  const { code, severity } = error;
  return code !== undefined && !code.startsWith("08") && !code.startsWith("57P") && code !== "40003"
    && severity !== "FATAL" && severity !== "PANIC";
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
