import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../src/modules/applications/errors.js";
import { LIMITS, parseCreate, parseListQuery, parseReplace } from "../../src/modules/applications/validation.js";

function rejects(run: () => unknown, status: number, message: RegExp) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ApplicationError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });
}

const RESUME = "2E853FAC-94FA-4DAB-AED5-E970F770D630";
const INTERVIEW = "11111111-1111-4111-8111-111111111111";

test("create needs only company and position; everything else defaults (PRD FR-04)", () => {
  assert.deepEqual(parseCreate({ companyName: "  Acme  ", jobTitle: "Engineer" }), {
    companyName: "Acme", jobTitle: "Engineer", status: "saved", appliedDate: null, jobDescription: null, jobUrl: null,
    resumeId: null, companyWebsiteUrl: null, companyNotes: null, notes: null, offerReceived: false, interviews: [],
  });
  rejects(() => parseCreate({ companyName: "Acme" }), 422, /jobTitle is required/);
  rejects(() => parseCreate({ companyName: "   ", jobTitle: "Engineer" }), 422, /companyName is required/);
  rejects(() => parseCreate({ companyName: "x".repeat(LIMITS.name + 1), jobTitle: "Engineer" }), 422, /at most 200/);
});

test("all fields are validated and normalized", () => {
  const input = parseCreate({
    companyName: "Acme", jobTitle: "Engineer", status: "oa", appliedDate: "2026-02-28", jobDescription: "  Build things\n",
    jobUrl: " https://example.com/jobs/1 ", resumeId: RESUME, companyWebsiteUrl: "", companyNotes: null, notes: "mine",
    offerReceived: true, interviews: [{ type: "  HR screen ", scheduledAt: "2026-11-12T10:00:00-05:00" }],
  });
  assert.equal(input.status, "oa");
  assert.equal(input.appliedDate, "2026-02-28");
  assert.equal(input.jobDescription, "  Build things\n", "multiline text keeps its whitespace");
  assert.equal(input.jobUrl, "https://example.com/jobs/1");
  assert.equal(input.resumeId, RESUME.toLowerCase());
  assert.equal(input.companyWebsiteUrl, null, "an empty string clears the field");
  assert.deepEqual(input.interviews, [{ type: "HR screen", scheduledAt: new Date("2026-11-12T15:00:00Z") }]);
});

test("old contract values and unsafe input are rejected with a field-specific message", () => {
  const base = { companyName: "Acme", jobTitle: "Engineer" };
  rejects(() => parseCreate({ ...base, status: "interviewing" }), 422, /status must be one of: saved, applied, oa, interview, offer, rejected/);
  rejects(() => parseCreate({ ...base, appliedAt: "2026-11-07T14:00:00Z" }), 422, /appliedAt is not an application field\. Use appliedDate/);
  rejects(() => parseCreate({ ...base, location: "Toronto" }), 422, /location is not an application field/);
  rejects(() => parseCreate({ ...base, appliedDate: "2026-02-30" }), 422, /YYYY-MM-DD/);
  rejects(() => parseCreate({ ...base, appliedDate: "2026-11-07T00:00:00Z" }), 422, /YYYY-MM-DD/);
  rejects(() => parseCreate({ ...base, jobUrl: "javascript:alert(1)" }), 422, /jobUrl must be an http or https URL/);
  rejects(() => parseCreate({ ...base, companyWebsiteUrl: "https://user:pw@example.com" }), 422, /http or https URL/);
  rejects(() => parseCreate({ ...base, resumeId: "not-a-uuid" }), 422, /resumeId/);
  rejects(() => parseCreate({ ...base, offerReceived: "yes" }), 422, /offerReceived/);
  rejects(() => parseCreate({ ...base, notes: 12 }), 422, /notes must be a string/);
  rejects(() => parseCreate([base]), 400, /JSON object/);
  rejects(() => parseCreate(undefined), 400, /JSON object/);
});

test("interviews: both fields required, name trimmed to 1–100 characters, instant with an offset", () => {
  const base = { companyName: "Acme", jobTitle: "Engineer" };
  const one = (interview: unknown) => () => parseCreate({ ...base, interviews: [interview] });
  rejects(one({ type: "   ", scheduledAt: "2026-11-12T15:00:00Z" }), 422, /interviews\[0\]\.type is required/);
  rejects(one({ type: "x".repeat(101), scheduledAt: "2026-11-12T15:00:00Z" }), 422, /at most 100/);
  rejects(one({ type: "HR" }), 422, /scheduledAt must be a date-time/);
  rejects(one({ type: "HR", scheduledAt: "2026-11-12T15:00:00" }), 422, /UTC offset/);
  rejects(one({ type: "HR", scheduledAt: "2026-11-12T15:00:00Z", location: "Zoom" }), 422, /location is not an interview field/);
  rejects(one({ id: INTERVIEW, type: "HR", scheduledAt: "2026-11-12T15:00:00Z" }), 422, /cannot be set when creating/);
  // A past instant is allowed (completed rounds), and 100 emoji are 100 characters.
  assert.equal(parseCreate({ ...base, interviews: [{ type: "😀".repeat(100), scheduledAt: "2001-01-01T00:00Z" }] }).interviews.length, 1);
  rejects(() => parseCreate({ ...base, interviews: Array(LIMITS.interviews + 1).fill({ type: "HR", scheduledAt: "2026-11-12T15:00:00Z" }) }), 422, /At most 50/);
});

test("replace is a full replacement: status is required, omitted fields are cleared, rowVersion is optional", () => {
  rejects(() => parseReplace({ companyName: "Acme", jobTitle: "Engineer" }), 422, /status is required/);
  const { input, rowVersion } = parseReplace({
    id: "ignored", createdAt: "ignored", statusHistory: [], resumeName: "ignored",
    companyName: "Acme", jobTitle: "Engineer", status: "interview", rowVersion: "3",
    interviews: [{ id: INTERVIEW.toUpperCase(), type: "Tech", scheduledAt: "2026-11-12T15:00:00Z" }, { type: "New", scheduledAt: "2026-11-13T15:00:00Z" }],
  });
  assert.equal(rowVersion, "3");
  assert.equal(input.offerReceived, false);
  assert.equal(input.jobUrl, null);
  assert.deepEqual(input.interviews.map((interview) => interview.id), [INTERVIEW, undefined]);
  assert.equal(parseReplace({ companyName: "A", jobTitle: "B", status: "saved", rowVersion: 7 }).rowVersion, "7");
  assert.equal(parseReplace({ companyName: "A", jobTitle: "B", status: "saved" }).rowVersion, undefined);
  rejects(() => parseReplace({ companyName: "A", jobTitle: "B", status: "saved", rowVersion: "0" }), 422, /rowVersion/);
  const twice = { id: INTERVIEW, type: "Tech", scheduledAt: "2026-11-12T15:00:00Z" };
  rejects(() => parseReplace({ companyName: "A", jobTitle: "B", status: "saved", interviews: [twice, twice] }), 422, /appears more than once/);
});

test("list query: q, status and sort, with 400 for bad values", () => {
  assert.deepEqual(parseListQuery({}), { sort: "newest" });
  assert.deepEqual(parseListQuery({ q: "  acme ", status: "offer", sort: "company" }), { q: "acme", status: "offer", sort: "company" });
  assert.deepEqual(parseListQuery({ q: "   ", status: "" }), { sort: "newest" }, "empty values mean All / no keyword");
  rejects(() => parseListQuery({ status: "interviewing" }), 400, /status must be one of/);
  rejects(() => parseListQuery({ sort: "oldest" }), 400, /sort must be newest or company/);
  rejects(() => parseListQuery({ q: ["a", "b"] }), 400, /Send q once/);
  rejects(() => parseListQuery({ q: "x".repeat(LIMITS.query + 1) }), 400, /at most 200/);
});
