/** An expected rejection with a public status, code and message (`{ error: { code, message } }`). */
export class ApplicationError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "VERSION_CONFLICT" | "GENERATION_ACTIVE" | "VALIDATION_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export const notFound = () => new ApplicationError(404, "NOT_FOUND", "Application not found.");
export const badRequest = (message: string) => new ApplicationError(400, "BAD_REQUEST", message);
export const invalid = (message: string) => new ApplicationError(422, "VALIDATION_ERROR", message);

export const versionConflict = () => new ApplicationError(409, "VERSION_CONFLICT",
  "This application was changed elsewhere. Reload it and try again.");
export const generationActive = () => new ApplicationError(409, "GENERATION_ACTIVE",
  "A generation is in progress for this application's AI conversations. Nothing was deleted; try again after it ends.");
export const resumeUnavailable = () => invalid("The selected resume does not exist or has been deleted.");
