import type { Express } from "express";
import { createPostgresResumeModule } from "./postgres-module.js";
import { createResumeRouter, type ResumeRouterOptions } from "./routes.js";

type MountOptions = Parameters<typeof createPostgresResumeModule>[0] & Pick<ResumeRouterOptions, "authenticate">;

export function mountPostgresResumeRoutes(app: Express, { authenticate, ...deps }: MountOptions) {
  const { service, startWorker } = createPostgresResumeModule(deps);
  app.use("/api/v1/resumes", createResumeRouter({ service, authenticate, log: deps.log }));
  return startWorker;
}
