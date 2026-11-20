import type { Router } from "express";
import { requireAuthContext } from "../../http/authorization.js";
import { createPostgresResumeModule } from "./postgres-module.js";
import { createResumeRouter } from "./routes.js";

/** Mount on the business router passed to createApp. Starting the worker is up to the caller. */
export function mountPostgresResumeRoutes(router: Router, deps: Parameters<typeof createPostgresResumeModule>[0]) {
  const { service, startWorker } = createPostgresResumeModule(deps);
  router.use("/resumes", createResumeRouter({ service, authenticate: requireAuthContext, log: deps.log }));
  return startWorker;
}
