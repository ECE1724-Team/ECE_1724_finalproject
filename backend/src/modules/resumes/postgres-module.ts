import { startCleanupWorker } from "./cleanup-worker.js";
import { createPostgresResumeRepository, createPostgresStorageCleanupRepository } from "./postgres-repository.js";
import { createResumeService, type ResumeServiceDeps } from "./service.js";

export function createPostgresResumeModule(options: Omit<ResumeServiceDeps, "resumes" | "cleanup">) {
  const cleanup = createPostgresStorageCleanupRepository();
  const resumes = createPostgresResumeRepository(cleanup);
  const deps = { ...options, resumes, cleanup };

  return {
    service: createResumeService(deps),
    startWorker: () => startCleanupWorker(deps),
  };
}
