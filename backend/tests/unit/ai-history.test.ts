import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEFAULT_HISTORY_LIMITS, HISTORY_TOO_LARGE, SUMMARY_RULES, buildSummaryRequest, buildTurnPrompt, estimateTokens, planContext,
  type BaseContext, type HistoryTurn,
} from "../../src/modules/ai/context/history.js";
import { currentMaterials, type MaterialSource } from "../../src/modules/ai/context/materials.js";
import type { MaterialVersion } from "../../src/modules/ai/context/prompt.js";

const V1: MaterialSource = {
  companyName: "Acme", positionTitle: "Backend Engineer", jobDescription: "Build APIs in Go.",
  companyWebsiteUrl: null, companyNotes: null,
  resume: { id: randomUUID(), name: "SWE_Resume_v1", contentVersion: "1", textAvailable: true, extractedText: "Built a payments API." },
};
const V2: MaterialSource = { ...V1, resume: { ...V1.resume!, id: randomUUID(), name: "SWE_Resume_v2", extractedText: "Led a team of four." } };

const versions = (source: MaterialSource): Record<string, MaterialVersion> =>
  Object.fromEntries(currentMaterials(source).map((m) => [m.kind, m]));
const base = (source = V1, input = "Next question, please."): BaseContext =>
  ({ materials: currentMaterials(source), baseline: versions(source), input });

/** `count` turns answered with `source`, each user and assistant text `length` ASCII characters long. */
function turns(count: number, length = 30, source = V1, from = 1): HistoryTurn[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(from + i).padStart(2, "0");
    return {
      sequenceNo: 2 * (from + i), materials: versions(source),
      user: `Q${n} `.padEnd(length, "q"), assistant: `A${n} `.padEnd(length, "a"),
    };
  });
}
const sizeOf = (list: HistoryTurn[]) =>
  estimateTokens(list.flatMap((t) => [{ role: "user" as const, content: t.user }, { role: "assistant" as const, content: t.assistant }]));

test("the estimate counts ASCII by three characters, other code points one each, plus message framing", () => {
  assert.equal(estimateTokens([{ role: "user", content: "abcdef" }]), 2 + 4);
  assert.equal(estimateTokens([{ role: "user", content: "你好吗" }]), 3 + 4);
  assert.equal(estimateTokens([{ role: "system", content: "ab😀" }, { role: "user", content: "" }]), 1 + 1 + 4 + 4);
});

test("twenty short turns below both limits are sent verbatim with no summary", () => {
  const history = turns(20);
  const plan = planContext(base(), null, history, DEFAULT_HISTORY_LIMITS);
  assert.equal(plan.action, "send");
  assert.equal(plan.action === "send" && plan.prompt.length, 2 + 40 + 1);
});

test("reaching the token threshold summarizes the older prefix and keeps the newest turns up to the window", () => {
  const turnSize = sizeOf(turns(1));
  const limits = { ...DEFAULT_HISTORY_LIMITS, compressAtTokens: 5 * turnSize, windowTokens: 2 * turnSize + 1 };

  assert.equal(planContext(base(), null, turns(4), limits).action, "send");
  const plan = planContext(base(), "Earlier summary", turns(5), limits);
  assert.equal(plan.action, "compress");
  if (plan.action !== "compress") return;
  assert.deepEqual(plan.covered.map((t) => t.sequenceNo), [2, 4, 6]);
  assert.deepEqual(plan.window.map((t) => t.sequenceNo), [8, 10]);

  // A single newest turn larger than the window is summarized too.
  const big = planContext(base(), null, [...turns(4), ...turns(1, 600, V1, 5)], limits);
  assert.equal(big.action === "compress" && big.window.length, 0);
});

test("the input limit alone triggers compression and shrinks the window by complete turns", () => {
  const history = turns(5, 300);
  const turnSize = sizeOf(history.slice(0, 1));
  const full = estimateTokens(buildTurnPrompt(base(), null, history));
  const limits = { maxInputTokens: full - 1, compressAtTokens: 1_000_000, windowTokens: 1_000_000, summaryTokens: 3 * turnSize };

  assert.equal(planContext(base(), null, history, { ...limits, maxInputTokens: full }).action, "send");
  const plan = planContext(base(), null, history, limits);
  assert.equal(plan.action, "compress");
  assert.deepEqual(plan.action === "compress" && [plan.covered.length, plan.window.length], [4, 1]);
});

test("materials and input that cannot fit name the largest parts to shorten", () => {
  const long = { ...V1, jobDescription: "j".repeat(6_000) };
  const limits = { ...DEFAULT_HISTORY_LIMITS, maxInputTokens: 500 };
  const plan = planContext(base(long, "x".repeat(300)), null, turns(2), limits);
  assert.equal(plan.action, "too_large");
  assert.match(plan.action === "too_large" ? plan.message : "",
    /^The materials and your message are too long for one AI request \(about [\d,]+ tokens; the limit is 500\)\. Shorten the largest: job description \(about 2,004 tokens\), your message \(about 104 tokens\), resume "SWE_Resume_v1" \(about \d+ tokens\)\.$/);
});

test("a summary that leaves no room suggests a new conversation", () => {
  const baseSize = estimateTokens(buildTurnPrompt(base(), null, []));
  const plan = planContext(base(), "s".repeat(3_000), [], { ...DEFAULT_HISTORY_LIMITS, maxInputTokens: baseSize + 500 });
  assert.deepEqual(plan, { action: "too_large", message: HISTORY_TOO_LARGE });
});

test("the answer request puts the escaped summary after the change notice and before the window", () => {
  const prompt = buildTurnPrompt({ ...base(V2), baseline: versions(V1) }, "Asked about <ownership> & on-call.", turns(1, 30, V1, 3));
  assert.deepEqual(prompt.map((m) => m.role), ["system", "system", "user", "assistant", "user"]);
  assert.match(prompt[1].content, /<\/material_changes>\n\n<conversation_summary>\nSummary of earlier turns[^\n]*\nAsked about &lt;ownership&gt; &amp; on-call\.\n<\/conversation_summary>$/);
  assert.match(prompt[3].content, /^\[based on earlier materials: resume "SWE_Resume_v1"\]\nA03 /);
  assert.equal(prompt[4].content, "Next question, please.");
});

test("the summary request merges the previous summary with new turns tagged by their material versions", () => {
  const request = buildSummaryRequest("Practiced <HR> questions.", [...turns(1, 30, V1, 3), ...turns(1, 30, V2, 4)]);
  assert.deepEqual(request.map((m) => m.role), ["system", "user"]);
  assert.equal(request[0].content, SUMMARY_RULES);
  assert.match(SUMMARY_RULES, /based on resume "SWE_Resume_v1"/);
  const body = request[1].content;
  assert.match(body, /^<previous_summary>\nPracticed &lt;HR&gt; questions\.\n<\/previous_summary>/);
  assert.match(body, /<user>\nQ03 q+\n<\/user>\n<assistant>\n\[based on: resume "SWE_Resume_v1"; job description version [0-9a-f]{8}; company version [0-9a-f]{8}; position version [0-9a-f]{8}; company website url not provided; company notes not provided\]\nA03 a+\n<\/assistant>/);
  assert.match(body, /\[based on: resume "SWE_Resume_v2";[^\]]*\]\nA04 /);
  assert.match(buildSummaryRequest(null, turns(1))[1].content, /^<previous_summary>\nNone yet\.\n<\/previous_summary>/);
});
