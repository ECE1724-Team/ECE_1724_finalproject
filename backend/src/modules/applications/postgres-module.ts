import type { Pool } from "pg";
import {
  createPostgresApplicationRepository, createPostgresApplicationStatusHistoryRepository, createPostgresInterviewRepository,
} from "./postgres-repository.js";
import { createApplicationService, type ApplicationService } from "./service.js";

/** The application service on Rongxin's PostgreSQL repositories. */
export function createPostgresApplicationService(pool: Pool): ApplicationService {
  return createApplicationService({
    pool,
    applications: createPostgresApplicationRepository(),
    interviews: createPostgresInterviewRepository(),
    history: createPostgresApplicationStatusHistoryRepository(),
  });
}
