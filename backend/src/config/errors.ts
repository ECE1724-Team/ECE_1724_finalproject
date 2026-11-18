/**
 * A startup problem the operator can fix: a missing or invalid setting, or a schema that has not
 * been migrated. Its message names the setting but never contains its value, so the server may
 * print it. Any other startup error is reported generically, because driver errors can quote
 * connection details.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
