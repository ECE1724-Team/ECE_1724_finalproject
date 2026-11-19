import type { ApplicationStatus } from "./repository.js";

export type { ApplicationStatus };

/** The six confirmed statuses (PRD FR-24, Database Design §5.3), in display order. */
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = ["saved", "applied", "oa", "interview", "offer", "rejected"];

export type ApplicationSort = "newest" | "company";

/** A validated interview from a request. `id` is present only for an existing interview. */
export interface InterviewInput {
  id?: string;
  /** Trimmed, 1–100 characters. */
  type: string;
  scheduledAt: Date;
}

/** Every client-editable field, after validation and defaults (full-replacement semantics). */
export interface ApplicationInput {
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  /** Calendar date, YYYY-MM-DD. */
  appliedDate: string | null;
  jobDescription: string | null;
  jobUrl: string | null;
  resumeId: string | null;
  companyWebsiteUrl: string | null;
  companyNotes: string | null;
  notes: string | null;
  offerReceived: boolean;
  interviews: InterviewInput[];
}

export interface ApplicationListQuery {
  q?: string;
  status?: ApplicationStatus;
  sort: ApplicationSort;
}

// ---- Response bodies ----

export interface InterviewResource {
  id: string;
  type: string;
  scheduledAt: Date;
}

export interface StatusChangeResource {
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
  changedAt: Date;
}

export interface ApplicationResource {
  id: string;
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  jobDescription: string | null;
  jobUrl: string | null;
  resumeId: string | null;
  /** Upload-time name of the linked live resume, for display. */
  resumeName: string | null;
  companyWebsiteUrl: string | null;
  companyNotes: string | null;
  notes: string | null;
  offerReceived: boolean;
  /** Ordered by `scheduledAt`, then `id`. */
  interviews: InterviewResource[];
  /** Actual status changes, oldest first (the activity timeline). Creation is not a change. */
  statusHistory: StatusChangeResource[];
  /** Decimal string. Send it back on PUT to detect concurrent edits. */
  rowVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationSummaryResource {
  id: string;
  companyName: string;
  jobTitle: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  resumeId: string | null;
  resumeName: string | null;
  createdAt: Date;
}

export interface ApplicationListResource {
  data: ApplicationSummaryResource[];
  /** Counts over all of the user's applications; `q` and `status` do not change them (PRD §5.5). */
  counts: { total: number; byStatus: Record<ApplicationStatus, number> };
}
