import { isUuid } from "../../lib/uuid.js";
import { badRequest, invalid } from "./errors.js";
import {
  APPLICATION_STATUSES, type ApplicationInput, type ApplicationListQuery, type ApplicationStatus, type InterviewInput,
} from "./types.js";

// Limits. Company/position and interview names follow PRD/endpoints.json; the long-text and URL
// caps only protect the database (PRD §11 leaves detailed lengths open) and are well above
// what the forms need. The JSON body itself is limited to 1 MB by app.ts.
export const LIMITS = Object.freeze({
  name: 200,
  interviewType: 100,
  jobDescription: 50_000,
  notes: 20_000,
  url: 2_048,
  interviews: 50,
  query: 200,
});

const EDITABLE = [
  "companyName", "jobTitle", "status", "appliedDate", "jobDescription", "jobUrl", "resumeId",
  "companyWebsiteUrl", "companyNotes", "notes", "offerReceived", "interviews",
] as const;
/** Server-owned fields a client may echo back from a GET; they are ignored. */
const READ_ONLY = new Set(["id", "resumeName", "statusHistory", "createdAt", "updatedAt"]);
const RENAMED: Readonly<Record<string, string>> = { appliedAt: "appliedDate", positionTitle: "jobTitle", personalNotes: "notes" };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// RFC 3339 instant with an explicit offset; seconds optional.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const ROW_VERSION = /^[1-9]\d{0,18}$/;

/** Length in characters (code points), as PostgreSQL's char_length counts them. */
const length = (value: string) => [...value].length;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredName(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalid(`${field} is required.`);
  const trimmed = value.trim();
  if (length(trimmed) > LIMITS.name) throw invalid(`${field} must be at most ${LIMITS.name} characters.`);
  return trimmed;
}

/** Optional text: absent, null or empty → null. Whitespace inside multiline text is kept. */
function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalid(`${field} must be a string or null.`);
  if (!value.trim()) return null;
  if (length(value) > max) throw invalid(`${field} must be at most ${max} characters.`);
  return value;
}

/** Optional link the UI will render: only absolute http(s) URLs (no javascript:, data:, …). */
function optionalUrl(value: unknown, field: string): string | null {
  const text = optionalText(value, field, LIMITS.url);
  if (text === null) return null;
  const trimmed = text.trim();
  const url = URL.canParse(trimmed) ? new URL(trimmed) : null;
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw invalid(`${field} must be an http or https URL.`);
  }
  return trimmed;
}

function status(value: unknown, field = "status"): ApplicationStatus {
  if (typeof value !== "string" || !(APPLICATION_STATUSES as readonly string[]).includes(value)) {
    throw invalid(`${field} must be one of: ${APPLICATION_STATUSES.join(", ")}.`);
  }
  return value as ApplicationStatus;
}

function appliedDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const match = typeof value === "string" ? DATE.exec(value) : null;
  // The round trip rejects impossible dates such as 2026-02-30.
  if (!match || new Date(`${value as string}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw invalid("appliedDate must be a calendar date in YYYY-MM-DD format, or null.");
  }
  return value as string;
}

function resumeId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) throw invalid("resumeId must be a resume ID or null.");
  return value.toLowerCase();
}

function interviews(value: unknown, allowIds: boolean): InterviewInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid("interviews must be an array.");
  if (value.length > LIMITS.interviews) throw invalid(`At most ${LIMITS.interviews} interviews can be saved.`);
  const seen = new Set<string>();
  return value.map((item: unknown, index): InterviewInput => {
    const at = `interviews[${index}]`;
    if (!isPlainObject(item)) throw invalid(`${at} must be an object.`);
    for (const key of Object.keys(item)) {
      if (key !== "id" && key !== "type" && key !== "scheduledAt") throw invalid(`${at}.${key} is not an interview field.`);
    }
    if (typeof item.type !== "string" || !item.type.trim()) throw invalid(`${at}.type is required.`);
    const type = item.type.trim();
    if (length(type) > LIMITS.interviewType) throw invalid(`${at}.type must be at most ${LIMITS.interviewType} characters.`);
    if (typeof item.scheduledAt !== "string" || !INSTANT.test(item.scheduledAt) || !Number.isFinite(Date.parse(item.scheduledAt))) {
      throw invalid(`${at}.scheduledAt must be a date-time with a UTC offset, such as 2026-11-12T15:00:00Z.`);
    }
    const interview: InterviewInput = { type, scheduledAt: new Date(item.scheduledAt) };
    if (item.id !== undefined && item.id !== null) {
      if (!allowIds) throw invalid(`${at}.id cannot be set when creating an application.`);
      if (!isUuid(item.id)) throw invalid(`${at}.id must be an interview ID.`);
      const id = item.id.toLowerCase();
      if (seen.has(id)) throw invalid(`${at}.id appears more than once.`);
      seen.add(id);
      interview.id = id;
    }
    return interview;
  });
}

function checkFields(body: Record<string, unknown>, extra: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if ((EDITABLE as readonly string[]).includes(key) || extra.includes(key) || READ_ONLY.has(key)) continue;
    const hint = RENAMED[key] ? ` Use ${RENAMED[key]}.` : "";
    throw invalid(`${key} is not an application field.${hint}`);
  }
}

function fields(body: Record<string, unknown>, { allowInterviewIds }: { allowInterviewIds: boolean }): ApplicationInput {
  if (body.offerReceived !== undefined && typeof body.offerReceived !== "boolean") throw invalid("offerReceived must be true or false.");
  return {
    companyName: requiredName(body.companyName, "companyName"),
    jobTitle: requiredName(body.jobTitle, "jobTitle"),
    status: body.status === undefined ? "saved" : status(body.status),
    appliedDate: appliedDate(body.appliedDate),
    jobDescription: optionalText(body.jobDescription, "jobDescription", LIMITS.jobDescription),
    jobUrl: optionalUrl(body.jobUrl, "jobUrl"),
    resumeId: resumeId(body.resumeId),
    companyWebsiteUrl: optionalUrl(body.companyWebsiteUrl, "companyWebsiteUrl"),
    companyNotes: optionalText(body.companyNotes, "companyNotes", LIMITS.notes),
    notes: optionalText(body.notes, "notes", LIMITS.notes),
    offerReceived: body.offerReceived === true,
    interviews: interviews(body.interviews, allowInterviewIds),
  };
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) throw badRequest("Send the application as a JSON object with Content-Type: application/json.");
  return body;
}

/** POST body. Only companyName and jobTitle are required; status defaults to saved (PRD FR-04). */
export function parseCreate(body: unknown): ApplicationInput {
  const object = objectBody(body);
  checkFields(object, ["rowVersion"]); // a copied rowVersion is ignored on create
  return fields(object, { allowInterviewIds: false });
}

/**
 * PUT body: a full replacement. companyName, jobTitle and status are required; every omitted
 * optional field is cleared (interviews → [], offerReceived → false). Interviews with an `id`
 * update that interview, ones without are added, and existing ones not listed are deleted.
 */
export function parseReplace(body: unknown): { input: ApplicationInput; rowVersion?: string } {
  const object = objectBody(body);
  checkFields(object, ["rowVersion"]);
  if (object.status === undefined) throw invalid("status is required.");
  const input = fields(object, { allowInterviewIds: true });
  const version = object.rowVersion;
  if (version === undefined || version === null) return { input };
  const text = typeof version === "number" && Number.isSafeInteger(version) ? String(version) : version;
  if (typeof text !== "string" || !ROW_VERSION.test(text)) throw invalid("rowVersion must be the value from the last GET.");
  return { input, rowVersion: text };
}

function singleQueryValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw badRequest(`Send ${name} once, as text.`);
  return value;
}

/** GET list query: `q` (company/position substring), `status`, `sort` (`newest` default, `company`). */
export function parseListQuery(query: Record<string, unknown>): ApplicationListQuery {
  const q = singleQueryValue(query.q, "q")?.trim();
  if (q && length(q) > LIMITS.query) throw badRequest(`q must be at most ${LIMITS.query} characters.`);
  const statusValue = singleQueryValue(query.status, "status");
  const sort = singleQueryValue(query.sort, "sort") ?? "newest";
  if (sort !== "newest" && sort !== "company") throw badRequest("sort must be newest or company.");
  let filter: ApplicationStatus | undefined;
  if (statusValue !== undefined && statusValue !== "") {
    if (!(APPLICATION_STATUSES as readonly string[]).includes(statusValue)) {
      throw badRequest(`status must be one of: ${APPLICATION_STATUSES.join(", ")}.`);
    }
    filter = statusValue as ApplicationStatus;
  }
  return { ...(q ? { q } : {}), ...(filter ? { status: filter } : {}), sort };
}
