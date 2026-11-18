import type { Pool, PoolClient } from "pg";

export type Db = Pool | PoolClient;
export type ApplicationStatus = "saved" | "applied" | "oa" | "interview" | "offer" | "rejected";

export interface ApplicationRow {
  id: string;
  userId: string;
  companyName: string;
  positionTitle: string;
  status: ApplicationStatus;
  /** Calendar date in YYYY-MM-DD format. */
  appliedDate: string | null;
  jobDescription: string | null;
  resumeId: string | null;
  jobUrl: string | null;
  companyWebsiteUrl: string | null;
  companyNotes: string | null;
  personalNotes: string | null;
  offerReceived: boolean;
  /** PostgreSQL bigint as a decimal string. */
  rowVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ApplicationDetailRow = ApplicationRow & { resumeName: string | null };
export type ApplicationListRow = Pick<ApplicationRow,
  "id" | "companyName" | "positionTitle" | "status" | "appliedDate" | "resumeId" | "rowVersion" | "createdAt"
> & { resumeName: string | null };

export interface ApplicationListOptions {
  search?: string;
  status?: ApplicationStatus;
  sort?: "newest" | "company";
  /** Optional display limit, such as for recent applications. */
  limit?: number;
}

export interface ApplicationCounts {
  statusCounts: Record<ApplicationStatus, number>;
  totalApplications: number;
  offersEverReceived: number;
}

type ApplicationFields = Omit<ApplicationRow, "id" | "userId" | "rowVersion" | "createdAt" | "updatedAt">;
export type ApplicationUpdate = Partial<ApplicationFields>;
export type NewApplication = Pick<ApplicationRow, "id" | "userId" | "companyName" | "positionTitle">
  & Partial<Omit<ApplicationFields, "companyName" | "positionTitle">>;

type SavedApplication = { outcome: "OK"; application: ApplicationRow };
export type ApplicationInsertResult = SavedApplication | { outcome: "RESUME_INELIGIBLE" };
export type ApplicationUpdateResult = ApplicationInsertResult | { outcome: "NOT_FOUND" | "VERSION_CONFLICT" };
export type ApplicationDeleteResult = "DELETED" | "NOT_FOUND" | "GENERATION_ACTIVE";

export interface ApplicationRepository {
  /** Pass a pool to run atomically, or an existing transaction client to compose writes. */
  insert(db: Db, application: NewApplication): Promise<ApplicationInsertResult>;
  get(db: Db, userId: string, id: string): Promise<ApplicationDetailRow | null>;
  list(db: Db, userId: string, options?: ApplicationListOptions): Promise<ApplicationListRow[]>;
  counts(db: Db, userId: string): Promise<ApplicationCounts>;
  /** Pass the current rowVersion when available. A concurrent resume relink can also conflict. */
  update(db: Db, userId: string, id: string, expectedRowVersion: string | undefined,
    changes: ApplicationUpdate): Promise<ApplicationUpdateResult>;
  /** Use for a combined save. Interview writes run on the same client after a successful update. Throw to roll back. */
  updateWithInterviews(pool: Pool, userId: string, id: string, expectedRowVersion: string | undefined,
    changes: ApplicationUpdate, saveInterviews: (client: PoolClient) => Promise<void>): Promise<ApplicationUpdateResult>;
  delete(pool: Pool, userId: string, id: string): Promise<ApplicationDeleteResult>;
}

export interface ApplicationStatusHistoryRow {
  id: string;
  applicationId: string;
  /** PostgreSQL bigint as a decimal string. */
  sequenceNo: string;
  oldStatus: ApplicationStatus;
  newStatus: ApplicationStatus;
  changedAt: Date;
}

export interface ApplicationStatusHistoryRepository {
  list(db: Db, userId: string, applicationId: string): Promise<ApplicationStatusHistoryRow[]>;
}

export interface InterviewRow {
  id: string;
  applicationId: string;
  interviewName: string;
  startsAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type InterviewFields = Pick<InterviewRow, "interviewName" | "startsAt">;
export type NewInterview = Pick<InterviewRow, "id" | "applicationId"> & InterviewFields & { userId: string };
export type InterviewUpdate = Partial<InterviewFields>;

export interface InterviewRepository {
  insert(db: Db, interview: NewInterview): Promise<InterviewRow | null>;
  list(db: Db, userId: string, applicationId: string): Promise<InterviewRow[]>;
  get(db: Db, userId: string, applicationId: string, interviewId: string): Promise<InterviewRow | null>;
  update(db: Db, userId: string, applicationId: string, interviewId: string,
    changes: InterviewUpdate): Promise<InterviewRow | null>;
  delete(db: Db, userId: string, applicationId: string, interviewId: string): Promise<boolean>;
}
