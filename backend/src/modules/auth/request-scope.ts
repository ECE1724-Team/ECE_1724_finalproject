import { AsyncLocalStorage } from "node:async_hooks";
import type { PendingCredential } from "./credentials.js";

/** State of one `/api/auth` request, shared by the handler, the hooks and the email callbacks. */
export interface AuthRequestScope {
  /** Credentials prepared inside the request transaction; queued only after it commits. */
  jobs: PendingCredential[];
  /** Set when issuing a credential failed. It fails the request even if Better Auth swallowed it. */
  issuanceError?: unknown;
  /** The error behind a 5xx answer from Better Auth, used to tell 503 from 500. */
  internalError?: unknown;
}

export interface RequestScopes {
  run<T>(work: (scope: AuthRequestScope) => Promise<T>): Promise<T>;
  current(): AuthRequestScope | undefined;
}

export function createRequestScopes(): RequestScopes {
  const storage = new AsyncLocalStorage<AuthRequestScope>();
  return {
    run(work) {
      const scope: AuthRequestScope = { jobs: [] };
      return storage.run(scope, () => work(scope));
    },
    current: () => storage.getStore(),
  };
}
