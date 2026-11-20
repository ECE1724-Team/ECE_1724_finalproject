import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../db/transaction.js";
import { generationActive, invalid, notFound, resumeUnavailable, versionConflict } from "./errors.js";
import type {
  ApplicationDetailRow, ApplicationListRow, ApplicationRepository, ApplicationStatusHistoryRepository,
  ApplicationStatusHistoryRow, ApplicationUpdate, Db, InterviewRepository, InterviewRow,
} from "./repository.js";
import type {
  ApplicationInput, ApplicationListQuery, ApplicationListResource, ApplicationResource, ApplicationSummaryResource, InterviewInput,
} from "./types.js";

export interface ApplicationServiceDeps {
  pool: Pool;
  applications: ApplicationRepository;
  interviews: InterviewRepository;
  history: ApplicationStatusHistoryRepository;
}

export interface ApplicationService {
  list(userId: string, query: ApplicationListQuery): Promise<ApplicationListResource>;
  create(userId: string, input: ApplicationInput): Promise<ApplicationResource>;
  get(userId: string, id: string): Promise<ApplicationResource>;
  /** Full replacement; `rowVersion` (optional) must match the stored one. */
  replace(userId: string, id: string, input: ApplicationInput, rowVersion?: string): Promise<ApplicationResource>;
  remove(userId: string, id: string): Promise<void>;
}

function toResource(row: ApplicationDetailRow, interviews: InterviewRow[], history: ApplicationStatusHistoryRow[]): ApplicationResource {
  return {
    id: row.id,
    companyName: row.companyName,
    jobTitle: row.positionTitle,
    status: row.status,
    appliedDate: row.appliedDate,
    jobDescription: row.jobDescription,
    jobUrl: row.jobUrl,
    resumeId: row.resumeId,
    resumeName: row.resumeName,
    companyWebsiteUrl: row.companyWebsiteUrl,
    companyNotes: row.companyNotes,
    notes: row.personalNotes,
    offerReceived: row.offerReceived,
    interviews: interviews.map((interview) => ({ id: interview.id, type: interview.interviewName, scheduledAt: interview.startsAt })),
    statusHistory: history.map((change) => ({ fromStatus: change.oldStatus, toStatus: change.newStatus, changedAt: change.changedAt })),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A list row in API field names. Also used for the Dashboard's recent applications. */
export function toSummary(row: ApplicationListRow): ApplicationSummaryResource {
  return {
    id: row.id,
    companyName: row.companyName,
    jobTitle: row.positionTitle,
    status: row.status,
    appliedDate: row.appliedDate,
    resumeId: row.resumeId,
    resumeName: row.resumeName,
    createdAt: row.createdAt,
  };
}

/** API field names → repository columns. Every field is set: PUT is a full replacement. */
function toColumns(input: ApplicationInput): Required<ApplicationUpdate> {
  return {
    companyName: input.companyName,
    positionTitle: input.jobTitle,
    status: input.status,
    appliedDate: input.appliedDate,
    jobDescription: input.jobDescription,
    resumeId: input.resumeId,
    jobUrl: input.jobUrl,
    companyWebsiteUrl: input.companyWebsiteUrl,
    companyNotes: input.companyNotes,
    personalNotes: input.notes,
    offerReceived: input.offerReceived,
  };
}

export function createApplicationService({ pool, applications, interviews, history }: ApplicationServiceDeps): ApplicationService {
  /** The detail read: application, its interviews and its status timeline. Queries run one at a time (a client cannot run two). */
  async function load(db: Db, userId: string, id: string): Promise<ApplicationResource | null> {
    const row = await applications.get(db, userId, id);
    if (!row) return null;
    const schedule = await interviews.list(db, userId, id);
    const timeline = await history.list(db, userId, id);
    return toResource(row, schedule, timeline);
  }

  async function insertInterview(client: PoolClient, userId: string, applicationId: string, interview: InterviewInput): Promise<void> {
    const row = await interviews.insert(client, {
      id: randomUUID(), applicationId, userId, interviewName: interview.type, startsAt: interview.scheduledAt,
    });
    // The application is locked or was just inserted in this transaction, so this cannot happen.
    if (!row) throw new Error("Interview insert found no owned application");
  }

  /**
   * Makes the stored schedule equal to `submitted`, keeping the identity of interviews that are
   * still listed: listed with an id → updated if changed; without an id → added; not listed → deleted.
   * Runs inside the update transaction, after the application row is locked.
   */
  async function syncInterviews(client: PoolClient, userId: string, applicationId: string, submitted: InterviewInput[]): Promise<boolean> {
    const existing = new Map((await interviews.list(client, userId, applicationId)).map((row) => [row.id, row]));
    submitted.forEach((interview, index) => {
      if (interview.id && !existing.has(interview.id)) throw invalid(`interviews[${index}].id is not an interview of this application.`);
    });
    const kept = new Set(submitted.flatMap((interview) => (interview.id ? [interview.id] : [])));
    let changed = false;
    for (const id of existing.keys()) {
      if (kept.has(id)) continue;
      if (!await interviews.delete(client, userId, applicationId, id)) throw new Error("Interview disappeared during save");
      changed = true;
    }
    for (const interview of submitted) {
      const current = interview.id ? existing.get(interview.id) : undefined;
      if (!current) {
        await insertInterview(client, userId, applicationId, interview);
        changed = true;
      } else if (current.interviewName !== interview.type || current.startsAt.getTime() !== interview.scheduledAt.getTime()) {
        const updated = await interviews.update(client, userId, applicationId, current.id, {
          interviewName: interview.type, startsAt: interview.scheduledAt,
        });
        if (!updated) throw new Error("Interview disappeared during save");
        changed = true;
      }
    }
    return changed;
  }

  return {
    async list(userId, query) {
      const [rows, counts] = await Promise.all([
        applications.list(pool, userId, { search: query.q, status: query.status, sort: query.sort }),
        applications.counts(pool, userId),
      ]);
      return { data: rows.map(toSummary), counts: { total: counts.totalApplications, byStatus: counts.statusCounts } };
    },

    async create(userId, input) {
      const id = randomUUID();
      const outcome = await withTransaction(pool, async (client) => {
        const inserted = await applications.insert(client, { id, userId, ...toColumns(input) });
        if (inserted.outcome !== "OK") return inserted.outcome;
        for (const interview of input.interviews) await insertInterview(client, userId, id, interview);
        return inserted.outcome;
      });
      if (outcome === "RESUME_INELIGIBLE") throw resumeUnavailable();
      const created = await load(pool, userId, id);
      if (!created) throw notFound(); // deleted again between commit and read
      return created;
    },

    async get(userId, id) {
      const application = await load(pool, userId, id);
      if (!application) throw notFound();
      return application;
    },

    async replace(userId, id, input, rowVersion) {
      const result = await applications.updateWithInterviews(pool, userId, id, rowVersion, toColumns(input),
        (client) => syncInterviews(client, userId, id, input.interviews));
      switch (result.outcome) {
        case "NOT_FOUND": throw notFound();
        case "VERSION_CONFLICT": throw versionConflict();
        case "RESUME_INELIGIBLE": throw resumeUnavailable();
        case "OK": break;
      }
      const updated = await load(pool, userId, id);
      if (!updated) throw notFound();
      return updated;
    },

    async remove(userId, id) {
      const result = await applications.delete(pool, userId, id);
      if (result === "NOT_FOUND") throw notFound();
      if (result === "GENERATION_ACTIVE") throw generationActive();
    },
  };
}
