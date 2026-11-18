import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ApplicationUpdateResult, NewApplication } from "../../src/modules/applications/repository.js";
import { createPostgresResumeRepository, createPostgresStorageCleanupRepository } from "../../src/modules/resumes/postgres-repository.js";
import type { Db, ParseStatus } from "../../src/modules/resumes/repository.js";

export function newApplication(userId: string, fields: Partial<NewApplication> = {}): NewApplication {
  return { id: randomUUID(), userId, companyName: "Example Company", positionTitle: "Engineer", ...fields };
}

export function savedApplication(result: ApplicationUpdateResult) {
  assert.ok(result.outcome === "OK", `Application save returned ${result.outcome}`);
  return result.application;
}

export const resumes = createPostgresResumeRepository(createPostgresStorageCleanupRepository());

export function insertResume(db: Db, userId: string, parseStatus: ParseStatus = "succeeded") {
  const id = randomUUID();
  return resumes.insert(db, {
    id, userId, name: "Example resume", originalFilename: "cv.pdf", objectKey: `resumes/${id}.pdf`,
    sizeBytes: 256, pageCount: 1,
    ...(parseStatus === "succeeded"
      ? { parseStatus, nonWhitespaceChars: 120, extractedText: "x".repeat(120) }
      : { parseStatus, nonWhitespaceChars: 0, extractedText: null }),
  });
}
