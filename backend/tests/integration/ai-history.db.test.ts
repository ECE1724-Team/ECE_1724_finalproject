import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";
import { DEFAULT_LIMITS } from "../../src/integrations/llm/openai.js";
import { DEFAULT_HISTORY_LIMITS, estimateTokens, type HistoryLimits } from "../../src/modules/ai/context/history.js";
import type { PromptMessage } from "../../src/modules/ai/context/prompt.js";
import { createConversation, listMessages } from "../../src/modules/ai/conversations/postgres-repository.js";
import { acceptInput, acceptRetry, listGenerations, type AcceptResult } from "../../src/modules/ai/generations/postgres-repository.js";
import { runTurn, type StreamEvent } from "../../src/modules/ai/generations/service.js";
import { ensureWorkspace } from "../../src/modules/ai/workspaces/postgres-repository.js";
import { createPostgresApplicationRepository } from "../../src/modules/applications/postgres-repository.js";
import { FakeLlm, type FakeStream } from "../fakes/llm.js";
import { newApplication, resumes, savedApplication } from "../helpers/applications.js";
import { insertTestOwners, withTestDatabase } from "../helpers/database.js";

const applications = createPostgresApplicationRepository();

// Every question is 60 ASCII characters and every reply 70, so with unchanged materials each
// completed turn is 24 + 28 = 52 estimated tokens: six turns reach 300, two fit in a 110 window.
const LIMITS: HistoryLimits = { ...DEFAULT_HISTORY_LIMITS, compressAtTokens: 300, windowTokens: 110 };
const question = (n: number) => `Question ${String(n).padStart(2, "0")}: tell me more`.padEnd(60, ".");

const isSummary = (call: FakeStream) => call.options.maxOutputTokens === DEFAULT_LIMITS.summaryOutputTokens;
const promptOf = (call: FakeStream): PromptMessage[] => call.options.prompt.map((message) => ({
  role: message.role as PromptMessage["role"],
  content: typeof message.content === "string" ? message.content
    : (message.content as { type: string; text?: string }[]).flatMap((part) => part.type === "text" ? part.text ?? "" : []).join(""),
}));
const questionsIn = (text: string) => [...text.matchAll(/Question (\d\d)/g)].map((match) => Number(match[1]));
/** The turns a summary request covers: each appears in its question and in the echoing reply. */
const turnsIn = (text: string) => [...new Set(questionsIn(text))];

async function setup(pool: Pool) {
  const { first: owner } = await insertTestOwners(pool);
  const addResume = (name: string, text: string) => {
    const id = randomUUID();
    return resumes.insert(pool, { id, userId: owner.id, name, originalFilename: `${name}.pdf`, objectKey: `resumes/${id}.pdf`,
      sizeBytes: 256, pageCount: 1, parseStatus: "succeeded", nonWhitespaceChars: 120, extractedText: text });
  };
  const v1 = await addResume("SWE_Resume_v1", "Built a payments API.");
  const application = savedApplication(await applications.insert(pool, newApplication(owner.id, {
    companyName: "Acme", positionTitle: "Backend Engineer", jobDescription: "Build APIs in Go.", resumeId: v1.id,
  })));
  const workspace = (await ensureWorkspace(pool, owner.id, application.id))!;

  // Summaries are numbered in call order; a flag hands that kind of call to the test instead.
  const llm = new FakeLlm();
  const hold = { summary: false, reply: false };
  let summaryCount = 0;
  llm.autoReply = (call) => {
    if (isSummary(call)) return hold.summary ? null : `Summary ${(summaryCount += 1)}`;
    return hold.reply ? null : `Reply to: ${call.lastUserText}`.slice(0, 70);
  };
  const model = llm.chatModel();

  const run = async (conversationId: string, accepted: AcceptResult, historyLimits: HistoryLimits) => {
    assert.equal(accepted.outcome, "ACCEPTED");
    if (accepted.outcome !== "ACCEPTED") throw new Error("not accepted");
    const events: StreamEvent[] = [];
    await runTurn({ pool, model, userId: owner.id, conversationId, generationId: accepted.generationId,
      signal: new AbortController().signal, emit: (event) => events.push(event), historyLimits });
    return { generationId: accepted.generationId, end: events.at(-1)! };
  };
  return {
    owner, llm, hold, application,
    newConversation: async () => (await createConversation(pool, owner.id, workspace.id))!.id,
    send: async (conversationId: string, content: string, limits = LIMITS) =>
      run(conversationId, await acceptInput(pool, owner.id, conversationId, content), limits),
    retry: async (conversationId: string, generationId: string, limits = LIMITS) =>
      run(conversationId, await acceptRetry(pool, owner.id, conversationId, generationId), limits),
    /** Sends questions `from`..`to` and checks each completes. */
    async turns(conversationId: string, from: number, to: number, limits = LIMITS) {
      for (let n = from; n <= to; n += 1) assert.equal((await this.send(conversationId, question(n), limits)).end.type, "generation.completed");
    },
    switchResume: async () => {
      const v2 = await addResume("SWE_Resume_v2", "Led a team of four.");
      savedApplication(await applications.update(pool, owner.id, application.id, undefined, { resumeId: v2.id }));
    },
    summaryCalls: () => llm.streams.filter(isSummary).map(promptOf),
    replyCalls: () => llm.streams.filter((call) => !isSummary(call)).map(promptOf),
    summaries: async (conversationId: string) => (await pool.query<{ id: string; through: number; text: string; previousId: string | null }>(`
      SELECT id, through_sequence_no::int AS through, summary_text AS text, previous_summary_id AS "previousId"
      FROM public.conversation_summaries WHERE conversation_id = $1 ORDER BY through_sequence_no
    `, [conversationId])).rows,
    metadata: async (generationId: string) => (await pool.query(
      "SELECT model_metadata FROM public.generation_runs WHERE id = $1", [generationId])).rows[0].model_metadata,
  };
}

test("twenty short turns below both limits make no summary call", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const s = await setup(pool);
  const conversationId = await s.newConversation();
  await s.turns(conversationId, 1, 20, DEFAULT_HISTORY_LIMITS);
  assert.equal(s.summaryCalls().length, 0);
  assert.deepEqual(await s.summaries(conversationId), []);
  const last = s.replyCalls().at(-1)!;
  assert.equal(last.length, 2 + 2 * 19 + 1);
  assert.deepEqual(questionsIn(last.slice(2).map((m) => m.content).join("\n")),
    Array.from({ length: 20 }, (_, i) => i + 1).flatMap((n) => n < 20 ? [n, n] : [n]));
}));

test("crossing the threshold adds one summary call; each summary extends its predecessor and covers every turn once",
  () => withTestDatabase(async ({ pool, migrate }) => {
    await migrate();
    const s = await setup(pool);
    const conversationId = await s.newConversation();
    await s.turns(conversationId, 1, 6);
    assert.equal(s.summaryCalls().length, 0);

    // Turn 7 sees six unsummarized turns (312 tokens): turns 1–4 are summarized, 5–6 stay verbatim.
    const seventh = await s.send(conversationId, question(7));
    assert.equal(seventh.end.type, "generation.completed");
    assert.equal(s.summaryCalls().length, 1);
    const [first] = await s.summaries(conversationId);
    assert.deepEqual({ ...first, id: undefined }, { id: undefined, through: 8, text: "Summary 1", previousId: null });
    assert.deepEqual(turnsIn(s.summaryCalls()[0][1].content), [1, 2, 3, 4]);
    const reply7 = s.replyCalls().at(-1)!;
    assert.match(reply7[1].content, /<conversation_summary>\n[^\n]*\nSummary 1\n<\/conversation_summary>$/);
    assert.match(reply7[1].content, /<resume version="SWE_Resume_v1">\nBuilt a payments API\./, "materials stay complete");
    assert.deepEqual(questionsIn(reply7.slice(2).map((m) => m.content).join("\n")), [5, 5, 6, 6, 7]);
    const usage = await s.metadata(seventh.generationId);
    assert.deepEqual(usage.summary, { inputTokens: 10, outputTokens: 5, finishReason: "stop" });
    assert.equal(usage.inputTokens, 10, "reply usage is recorded separately");

    // Turns 8–10 stay under the threshold; turn 11 summarizes 5–8 on top of the first summary.
    await s.turns(conversationId, 8, 10);
    assert.equal(s.summaryCalls().length, 1);
    await s.send(conversationId, question(11));
    assert.equal(s.summaryCalls().length, 2);
    const [, second] = await s.summaries(conversationId);
    assert.deepEqual({ ...second, id: undefined }, { id: undefined, through: 16, text: "Summary 2", previousId: first.id });
    const request = s.summaryCalls()[1][1].content;
    assert.match(request, /^<previous_summary>\nSummary 1\n<\/previous_summary>/);
    const reply11 = s.replyCalls().at(-1)!;
    assert.match(reply11[1].content, /\nSummary 2\n/);
    assert.doesNotMatch(reply11[1].content, /Summary 1/);

    // Every completed turn appears exactly once across the summarized prefixes and the window.
    const covered = [s.summaryCalls()[0][1].content, request, reply11.slice(2, -1).map((m) => m.content).join("\n")];
    assert.deepEqual(covered.map(turnsIn), [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
    for (let n = 1; n <= 10; n += 1) assert.equal(covered.filter((text) => turnsIn(text).includes(n)).length, 1);
    assert.equal(reply11.at(-1)!.content, question(11));
    // The full original history is still readable.
    assert.equal((await listMessages(pool, s.owner.id, conversationId))!.length, 22);
  }));

test("a failed summary keeps the boundary; the reply falls back to all later turns while they fit", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const s = await setup(pool);
  const conversationId = await s.newConversation();
  await s.turns(conversationId, 1, 6);

  s.hold.summary = true;
  const pending = s.send(conversationId, question(7));
  (await s.llm.next()).fail();
  const seventh = await pending;
  assert.equal(seventh.end.type, "generation.completed");
  assert.deepEqual(await s.summaries(conversationId), []);
  assert.deepEqual(questionsIn(s.replyCalls().at(-1)!.slice(2).map((m) => m.content).join("\n")),
    [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7]);
  assert.equal((await s.metadata(seventh.generationId)).summary, undefined);

  // Next turn: the summary is saved, then the reply fails. The retry reuses the summary.
  s.hold.summary = false;
  s.hold.reply = true;
  const failing = s.send(conversationId, question(8));
  (await s.llm.next()).fail();
  const failed = await failing;
  assert.equal(failed.end.type, "generation.error");
  assert.deepEqual((await s.summaries(conversationId)).map((row) => row.through), [10]);
  assert.equal(s.summaryCalls().length, 2);

  s.hold.reply = false;
  const retried = await s.retry(conversationId, failed.generationId);
  assert.equal(retried.end.type, "generation.completed");
  assert.equal(s.summaryCalls().length, 2, "the retry makes no summary call");
  const reply = s.replyCalls().at(-1)!;
  assert.match(reply[1].content, /\nSummary 1\n/);
  assert.deepEqual(questionsIn(reply.slice(2).map((m) => m.content).join("\n")), [6, 6, 7, 7, 8]);
}));

test("when later turns cannot fit without a summary, a failed summary fails the turn and a retry compresses",
  () => withTestDatabase(async ({ pool, migrate }) => {
    await migrate();
    const s = await setup(pool);
    const conversationId = await s.newConversation();
    await s.turns(conversationId, 1, 6, DEFAULT_HISTORY_LIMITS);
    // Turn 7's full request is one more 52-token turn than turn 6's; make it one token too large.
    const limit = estimateTokens(s.replyCalls().at(-1)!) + 52 - 1;
    const limits = { maxInputTokens: limit, compressAtTokens: 1_000_000, windowTokens: 1_000_000, summaryTokens: 50 };

    s.hold.summary = true;
    const pending = s.send(conversationId, question(7), limits);
    (await s.llm.next()).fail();
    const failed = await pending;
    assert.deepEqual(failed.end, {
      type: "generation.error", generationId: failed.generationId, stage: "context", statePersisted: true,
      error: { code: "GENERATION_FAILED", message: "Older messages could not be summarized to make room for this reply. Try again." },
    });
    assert.equal(s.replyCalls().length, 6, "no reply call");
    assert.deepEqual(await s.summaries(conversationId), []);

    s.hold.summary = false;
    const retried = await s.retry(conversationId, failed.generationId, limits);
    assert.equal(retried.end.type, "generation.completed");
    const [summary] = await s.summaries(conversationId);
    const reply = s.replyCalls().at(-1)!;
    assert.ok(estimateTokens(reply) <= limit);
    // The window holds the turns after the boundary, then the input once.
    const window = questionsIn(reply.slice(2).map((m) => m.content).join("\n"));
    assert.equal(window[0], summary.through / 2 + 1);
    assert.deepEqual(window.slice(-1), [7]);
    assert.equal(window.filter((n) => n === 7).length, 1);
  }));

test("each conversation selects only its own summary", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const s = await setup(pool);
  const a = await s.newConversation();
  const b = await s.newConversation();
  await s.turns(a, 1, 7);
  await s.turns(b, 1, 6);
  assert.equal(s.summaryCalls().length, 1);
  assert.doesNotMatch(s.replyCalls().at(-1)![1].content, /conversation_summary/);

  await s.send(b, question(7));
  assert.match(s.summaryCalls()[1][1].content, /^<previous_summary>\nNone yet\.\n<\/previous_summary>/);
  assert.match(s.replyCalls().at(-1)![1].content, /\nSummary 2\n/);
  await s.send(a, question(8));
  assert.match(s.replyCalls().at(-1)![1].content, /\nSummary 1\n/);
  assert.deepEqual((await s.summaries(a)).map((row) => row.text), ["Summary 1"]);
  assert.deepEqual((await s.summaries(b)).map((row) => row.text), ["Summary 2"]);
}));

test("after a switch to V2 the summary tags V1 points and the answer uses V2 as current", () => withTestDatabase(async ({ pool, migrate }) => {
  await migrate();
  const s = await setup(pool);
  const conversationId = await s.newConversation();
  await s.turns(conversationId, 1, 6);
  await s.switchResume();
  await s.send(conversationId, question(7));

  const [request] = s.summaryCalls();
  assert.equal(request[1].content.match(/\[based on: resume "SWE_Resume_v1";/g)?.length, turnsIn(request[1].content).length);
  const reply = s.replyCalls().at(-1)!;
  assert.match(reply[1].content, /<resume version="SWE_Resume_v2">\nLed a team of four\.\n<\/resume>/);
  assert.match(reply[1].content, /- Resume changed from "SWE_Resume_v1" to "SWE_Resume_v2"\./);
  assert.doesNotMatch(reply[1].content, /Built a payments API/);
  for (const message of reply.slice(2, -1).filter((m) => m.role === "assistant")) {
    assert.match(message.content, /^\[based on earlier materials: resume "SWE_Resume_v1"\]\n/);
  }
}));

test("materials and input that exceed the limit fail with CONTEXT_CAPACITY_EXCEEDED and no model call",
  () => withTestDatabase(async ({ pool, migrate }) => {
    await migrate();
    const s = await setup(pool);
    await applications.update(pool, s.owner.id, s.application.id, undefined, { jobDescription: "j".repeat(6_000) });
    const conversationId = await s.newConversation();
    const result = await s.send(conversationId, "Review my resume.", { ...DEFAULT_HISTORY_LIMITS, maxInputTokens: 2_500 });
    assert.equal(result.end.type, "generation.error");
    if (result.end.type !== "generation.error") return;
    assert.equal(result.end.stage, "context");
    assert.equal(result.end.error.code, "CONTEXT_CAPACITY_EXCEEDED");
    assert.match(result.end.error.message, /Shorten the largest: job description \(about 2,004 tokens\)/);
    assert.equal(s.llm.streams.length, 0);
    const [generation] = (await listGenerations(pool, s.owner.id, conversationId))!;
    assert.equal(generation.status, "failed");
    assert.equal(generation.error?.code, "CONTEXT_CAPACITY_EXCEEDED");
    assert.equal((await listMessages(pool, s.owner.id, conversationId))!.length, 1, "the input is kept");
  }));
