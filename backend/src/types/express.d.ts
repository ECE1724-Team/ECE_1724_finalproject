import type { VerifiedAuthContext } from "../modules/auth/types.js";

declare global {
  namespace Express {
    interface Locals {
      /**
       * Set only by `requireVerifiedUser`, after an authoritative Session read. Business handlers
       * read it through `getAuthContext(res)`; never fill it from the request.
       */
      auth?: VerifiedAuthContext;
    }
  }
}

export {};
