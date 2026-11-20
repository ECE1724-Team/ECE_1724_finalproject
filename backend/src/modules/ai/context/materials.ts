import { createHash } from "node:crypto";
import type { Db } from "../../../db/pool.js";

// The material registry (AI Design §4.2, Database Design §5.9). Every kind is read by backend
// code on every turn; adding a kind means adding an entry here and its source field below.

export type Availability = "available" | "unavailable";

/** The saved application fields and live linked resume that materials are read from. */
export interface MaterialSource {
  companyName: string;
  positionTitle: string;
  jobDescription: string | null;
  companyWebsiteUrl: string | null;
  companyNotes: string | null;
  /** The live linked resume of the same owner, or null when none is linked. */
  resume: {
    id: string;
    name: string;
    contentVersion: string;
    textAvailable: boolean;
    extractedText: string | null;
  } | null;
}

/** One material as it would be supplied now, with its fingerprint. */
export interface CurrentMaterial {
  kind: string;
  fingerprint: string;
  availability: Availability;
  reasonCode: string | null;
  sourceResumeId: string | null;
  sourceLabel: string | null;
  contentText: string | null;
}

interface MaterialKind {
  kind: string;
  /** XML tag used in the model context. */
  tag: string;
  /** Human-readable name used in change notices. */
  title: string;
  read(source: MaterialSource): Omit<CurrentMaterial, "kind" | "fingerprint">;
}

function field(text: string | null): Omit<CurrentMaterial, "kind" | "fingerprint"> {
  const missing = text === null || text.trim() === "";
  return {
    availability: missing ? "unavailable" : "available",
    reasonCode: missing ? "FIELD_MISSING" : null,
    sourceResumeId: null,
    sourceLabel: null,
    contentText: missing ? null : text,
  };
}

export const MATERIAL_KINDS: readonly MaterialKind[] = [
  {
    kind: "resume",
    tag: "resume",
    title: "Resume",
    read({ resume }) {
      if (!resume) {
        return { availability: "unavailable", reasonCode: "RESUME_NOT_LINKED", sourceResumeId: null, sourceLabel: null, contentText: null };
      }
      // A text-unavailable resume keeps its identity, so linking or unlinking it is still a change.
      const readable = resume.textAvailable && resume.extractedText !== null;
      return {
        availability: readable ? "available" : "unavailable",
        reasonCode: readable ? null : "RESUME_TEXT_UNAVAILABLE",
        sourceResumeId: resume.id,
        sourceLabel: resume.name,
        contentText: readable ? resume.extractedText : null,
      };
    },
  },
  { kind: "jd", tag: "job_description", title: "Job description", read: (s) => field(s.jobDescription) },
  { kind: "company", tag: "company", title: "Company", read: (s) => field(s.companyName) },
  { kind: "position", tag: "position", title: "Position", read: (s) => field(s.positionTitle) },
  { kind: "company_website_url", tag: "company_website_url", title: "Company website URL", read: (s) => field(s.companyWebsiteUrl) },
  { kind: "company_notes", tag: "company_notes", title: "Company notes", read: (s) => field(s.companyNotes) },
];

export function materialKind(kind: string): MaterialKind | undefined {
  return MATERIAL_KINDS.find((entry) => entry.kind === kind);
}

/** `v1:` + SHA-256 of the stored values (not the rendered prompt), in a fixed order. */
export function fingerprint(material: Omit<CurrentMaterial, "fingerprint" | "sourceLabel">): string {
  const canonical = JSON.stringify([
    material.kind, material.availability, material.reasonCode, material.sourceResumeId, material.contentText,
  ]);
  return `v1:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Every registered material, in registry order. */
export function currentMaterials(source: MaterialSource): CurrentMaterial[] {
  return MATERIAL_KINDS.map(({ kind, read }) => {
    const value = { kind, ...read(source) };
    return { ...value, fingerprint: fingerprint(value) };
  });
}

/**
 * Kinds whose fingerprint differs from the baseline, including kinds the baseline lacks. With no
 * baseline (no completed answer yet) every kind is new.
 */
export function changedKinds(current: { kind: string; fingerprint: string }[],
  baseline: Record<string, { fingerprint: string }> | null): string[] {
  return current.filter(({ kind, fingerprint }) => baseline?.[kind]?.fingerprint !== fingerprint).map(({ kind }) => kind);
}

/**
 * Reads the material source of an application the caller has already authorized. Personal notes,
 * status, interviews, applied date and job URL are deliberately not selected (Database Design §2.9).
 * Used by the workspace view and by turn preparation, so both compute the same fingerprints.
 */
export async function readMaterialSource(db: Db, applicationId: string): Promise<MaterialSource | null> {
  const { rows: [row] } = await db.query<{
    companyName: string; positionTitle: string; jobDescription: string | null;
    companyWebsiteUrl: string | null; companyNotes: string | null;
    resumeId: string | null; resumeName: string | null; contentVersion: string | null;
    parseStatus: string | null; extractedText: string | null;
  }>(`
    SELECT a.company_name AS "companyName", a.position_title AS "positionTitle",
           a.job_description AS "jobDescription", a.company_website_url AS "companyWebsiteUrl",
           a.company_notes AS "companyNotes",
           r.id AS "resumeId", r.name AS "resumeName", r.content_version::text AS "contentVersion",
           r.parse_status AS "parseStatus", r.extracted_text AS "extractedText"
    FROM public.applications a
    LEFT JOIN public.resumes r ON r.id = a.resume_id AND r.user_id = a.user_id AND r.deleted_at IS NULL
    WHERE a.id = $1
  `, [applicationId]);
  if (!row) return null;
  return {
    companyName: row.companyName,
    positionTitle: row.positionTitle,
    jobDescription: row.jobDescription,
    companyWebsiteUrl: row.companyWebsiteUrl,
    companyNotes: row.companyNotes,
    resume: row.resumeId === null ? null : {
      id: row.resumeId,
      name: row.resumeName!,
      contentVersion: row.contentVersion!,
      textAvailable: row.parseStatus === "succeeded",
      extractedText: row.extractedText,
    },
  };
}
