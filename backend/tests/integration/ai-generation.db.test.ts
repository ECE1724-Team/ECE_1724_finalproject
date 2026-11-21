import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { Router } from "express";
import { createApp } from "../../src/app.js";
import type { ChatModel } from "../../src/integrations/llm/openai.js";
import { acceptInput, recoverAbandonedGenerations } from "../../src/modules/ai/generations/postgres-repository.js";
import { createAiRouter } from "../../src/modules/ai/routes.js";
import { createPostgresApplicationRepository } from "../../src/modules/applications/postgres-repository.js";
import { FakeLlm } from "../fakes/llm.js";
import { insertResume, newApplication, savedApplication } from "../helpers/applications.js";
import { createAuthFixture, verifiedUser, type AuthFixture } from "../helpers/auth-fixture.js";

const applications = createPostgresApplicationRepository();
const KINDS = ["company", "company_notes", "company_website_url", "jd", "position", "resume"];

interface Message { id: string; generationId: string | null; sequenceNo: string; role: string; parts: { type: string; text: string }[] }
interface Generation { id: string; inputMessageId: string; status: string; materials: Record<string, { snapshotId: string }> | null;
  changedKinds: string[] | null; assistantMessageId: string | null; error: { code: string } | null }
type Event = Record<string, any> & { type: string };

/** Reads SSE frames one at a time and checks that `event:` matches `data.type`. */
function sse(response: Response) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  return {
    async next(): Promise<Event | null> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.+)$/m.exec(frame)![1];
          const data = JSON.parse(/^data: (.+)$/m.exec(frame)![1]) as Event;
          assert.equal(data.type, name);
          return data;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += value;
      }
    },
  };
}

async function startServer(t: TestContext, model?: ChatModel) {
  const fixture = await createAuthFixture();
  const businessRouter = Router();
  businessRouter.use(createAiRouter({ pool: fixture.pool, model }));
  const app = createApp({ authentication: fixture.authentication, database: fixture.database,
    environment: { auth: fixture.config, trustProxyHops: 0 }, businessRouter });
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    server.closeAllConnections();
    try { await promisify(server.close).call(server); }
    finally { await fixture.close(); }
  });
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = (path: string, cookie: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) => fetch(base + path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { origin: "http://localhost:5173", cookie, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  return { fixture, call };
}

/** A verified user with an application, its workspace and `count` empty conversations. */
async function seed(fixture: AuthFixture, call: Awaited<ReturnType<typeof startServer>>["call"], count = 1) {
  const owner = await verifiedUser(fixture);
  const resume = await insertResume(fixture.pool, owner.id);
  const application = savedApplication(await applications.insert(fixture.pool, newApplication(owner.id,
    { companyName: "Acme", positionTitle: "Backend Engineer", jobDescription: "Build APIs", resumeId: resume.id })));
  const workspace = await (await call(`/applications/${application.id}/ai-workspace`, owner.cookie, { method: "PUT" })).json() as { id: string };
  const conversations: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const created = await call(`/ai/workspaces/${workspace.id}/conversations`, owner.cookie, { method: "POST" });
    conversations.push((await created.json() as { id: string }).id);
  }
  return { owner, application, conversations };
}

async function json<T>(response: Response, status = 200): Promise<T> {
  assert.equal(response.status, status);
  return await response.json() as T;
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal((await json<{ error: { code: string } }>(response, status)).error.code, code);
}

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 250; i += 1) {
    if (await check()) return;
    await sleep(20);
  }
  assert.fail("condition not reached");
}

test("a send streams accepted, synced, deltas and completed; reads recover the saved reply", { timeout: 60_000 }, async (t) => {
  const llm = new FakeLlm();
  const { fixture, call } = await startServer(t, llm.chatModel());
  const { owner, conversations: [conversationId] } = await seed(fixture, call);
  const other = await verifiedUser(fixture);
  const path = `/ai/conversations/${conversationId}`;
  const countMessages = async () => (await fixture.pool.query("SELECT count(*)::int AS n FROM public.messages")).rows[0].n as number;

  for (const body of [{}, { content: "  " }, { content: 3 }, { content: "Hi", role: "system" }]) {
    await expectError(await call(`${path}/generations`, owner.cookie, { body }), 400, "BAD_REQUEST");
  }
  await expectError(await call(`${path}/generations`, other.cookie, { body: { content: "Hi" } }), 404, "NOT_FOUND");
  assert.equal(await countMessages(), 0);

  const response = await call(`${path}/generations`, owner.cookie, { body: { content: "Review my resume. Then quiz me." } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const events = sse(response);

  const accepted = await events.next();
  assert.equal(accepted?.type, "generation.accepted");
  const { generationId, inputMessage } = accepted!;
  assert.deepEqual([inputMessage.role, inputMessage.sequenceNo, inputMessage.generationId, inputMessage.parts],
    ["user", "1", null, [{ type: "text", text: "Review my resume. Then quiz me." }]]);
  const synced = await events.next();
  assert.equal(synced?.type, "materials.synced");
  assert.equal(synced!.baselineGenerationId, null);
  assert.deepEqual([...synced!.changedKinds].sort(), KINDS);
  assert.deepEqual(Object.keys(synced!.materials).sort(), KINDS);
  assert.deepEqual(Object.keys(synced!.materials.resume).sort(), ["availability", "fingerprint", "kind", "reasonCode", "snapshotId", "sourceResumeId"]);

  const stream = await llm.next();
  assert.equal(stream.lastUserText, "Review my resume. Then quiz me.");
  stream.delta("Add ");
  assert.deepEqual(await events.next(), { type: "text.delta", generationId, delta: "Add " });
  const streaming = await json<Generation>(await call(`${path}/generations/${generationId}`, owner.cookie));
  assert.deepEqual([streaming.status, streaming.assistantMessageId], ["streaming", null]);
  assert.equal((await json<Generation>(await call(path, owner.cookie)) as unknown as { activeGenerationId: string }).activeGenerationId, generationId);
  assert.equal(await countMessages(), 1, "deltas are not saved");
  stream.delta("metrics.");
  stream.finish();
  assert.deepEqual(await events.next(), { type: "text.delta", generationId, delta: "metrics." });

  const completed = await events.next();
  assert.equal(completed?.type, "generation.completed");
  assert.equal(completed!.generation.status, "completed");
  assert.equal(completed!.message.id, completed!.generation.assistantMessageId);
  assert.equal(completed!.message.generationId, generationId);
  assert.deepEqual(completed!.message.parts, [{ type: "text", text: "Add metrics." }]);
  assert.equal(await events.next(), null);

  // A client that missed the completion event recovers it from the durable reads.
  const generation = await json<Generation>(await call(`${path}/generations/${generationId}`, owner.cookie));
  assert.deepEqual(generation, JSON.parse(JSON.stringify(completed!.generation)));
  assert.deepEqual((await json<{ data: Generation[] }>(await call(`${path}/generations`, owner.cookie))).data, [generation]);
  const history = (await json<{ data: Message[] }>(await call(`${path}/messages`, owner.cookie))).data;
  assert.deepEqual(history.map((m) => [m.role, m.sequenceNo, m.parts[0].text]), [["user", "1", "Review my resume. Then quiz me."], ["assistant", "2", "Add metrics."]]);
  const conversation = await json<{ title: string; activeGenerationId: null; materialState: object }>(await call(path, owner.cookie));
  assert.equal(conversation.title, "Review my resume.");
  assert.equal(conversation.activeGenerationId, null);
  assert.deepEqual(Object.keys(conversation.materialState).sort(), KINDS);
  const { rows: [run] } = await fixture.pool.query("SELECT model_metadata FROM public.generation_runs WHERE id = $1", [generationId]);
  assert.deepEqual(run.model_metadata, { provider: "fake", model: "fake-model", inputTokens: 10, outputTokens: 5, finishReason: "stop" });

  // Snapshots are read within their conversation only.
  const snapshotPath = `${path}/material-snapshots/${generation.materials!.resume.snapshotId}`;
  const snapshot = await json<Record<string, unknown>>(await call(snapshotPath, owner.cookie));
  assert.deepEqual([snapshot.kind, snapshot.availability, snapshot.contentText], ["resume", "available", "x".repeat(120)]);
  assert.equal("sourceLabel" in snapshot, false);
  await expectError(await call(snapshotPath, other.cookie), 404, "NOT_FOUND");
  await expectError(await call(`${path}/generations/${generationId}`, other.cookie), 404, "NOT_FOUND");

  // The follow-up sees the first turn and no change notice.
  llm.autoReply = "Question 1: tell me about a project.";
  const followUp = sse(await call(`${path}/generations`, owner.cookie, { body: { content: "Start the interview." } }));
  const types: string[] = [];
  for (let event = await followUp.next(); event; event = await followUp.next()) types.push(event.type);
  assert.deepEqual(types, ["generation.accepted", "materials.synced", "text.delta", "generation.completed"]);
  const prompt = llm.streams[1].options.prompt;
  assert.deepEqual(prompt.map((m) => m.role), ["system", "system", "user", "assistant", "user"]);
  assert.doesNotMatch(JSON.stringify(prompt[1]), /material_changes/);
});

test("one active generation per conversation, two conversations at once, and the deletion guard", { timeout: 60_000 }, async (t) => {
  const llm = new FakeLlm();
  const { fixture, call } = await startServer(t, llm.chatModel());
  const { owner, application, conversations: [a, b] } = await seed(fixture, call, 2);
  const send = async (conversationId: string, content: string) => {
    const events = sse(await call(`/ai/conversations/${conversationId}/generations`, owner.cookie, { body: { content } }));
    assert.equal((await events.next())?.type, "generation.accepted");
    assert.equal((await events.next())?.type, "materials.synced");
    return { events, stream: await llm.next() };
  };

  const first = await send(a, "Hello A");
  await expectError(await call(`/ai/conversations/${a}/generations`, owner.cookie, { body: { content: "Again" } }), 409, "GENERATION_ACTIVE");
  const second = await send(b, "Hello B");
  assert.equal(await applications.delete(fixture.pool, owner.id, application.id), "GENERATION_ACTIVE");

  second.stream.delta("B done");
  second.stream.finish();
  first.stream.delta("A done");
  first.stream.finish();
  for (const { events } of [second, first]) {
    let last: Event | null = null;
    for (let event = await events.next(); event; event = await events.next()) last = event;
    assert.equal(last?.type, "generation.completed");
  }
  const { rows } = await fixture.pool.query(`
    SELECT conversation_id, string_agg(parts->0->>'text', ' | ' ORDER BY sequence_no) AS texts
    FROM public.messages GROUP BY conversation_id
  `);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.conversation_id, row.texts])),
    { [a]: "Hello A | A done", [b]: "Hello B | B done" }, "the rejected send saved nothing");
  assert.equal(await applications.delete(fixture.pool, owner.id, application.id), "DELETED");
});

test("failures, retry, client disconnect and restart recovery", { timeout: 60_000 }, async (t) => {
  const llm = new FakeLlm();
  const { fixture, call } = await startServer(t, llm.chatModel());
  const { owner, conversations: [conversationId] } = await seed(fixture, call);
  const path = `/ai/conversations/${conversationId}`;
  const drain = async (events: ReturnType<typeof sse>) => {
    const all: Event[] = [];
    for (let event = await events.next(); event; event = await events.next()) all.push(event);
    return all;
  };
  const generation = (id: string) => call(`${path}/generations/${id}`, owner.cookie).then((r) => json<Generation>(r));

  // A model failure ends the stream with generation.error and saves no reply.
  const failing = sse(await call(`${path}/generations`, owner.cookie, { body: { content: "Mock interview, please." } }));
  const accepted = (await failing.next())!;
  await failing.next();
  (await llm.next()).fail();
  assert.deepEqual(await drain(failing), [{ type: "generation.error", generationId: accepted.generationId, stage: "generation",
    statePersisted: true, error: { code: "GENERATION_FAILED", message: "The AI could not finish this reply. Try again." } }]);
  assert.equal((await generation(accepted.generationId)).error?.code, "GENERATION_FAILED");

  // Retry keeps the original input and creates a new attempt.
  await expectError(await call(`${path}/generations/${crypto.randomUUID()}/retry`, owner.cookie, { method: "POST" }), 404, "NOT_FOUND");
  llm.autoReply = "First question: why Acme?";
  const retried = await drain(sse(await call(`${path}/generations/${accepted.generationId}/retry`, owner.cookie, { method: "POST" })));
  assert.deepEqual(retried.map((e) => e.type), ["generation.accepted", "materials.synced", "text.delta", "generation.completed"]);
  assert.notEqual(retried[0].generationId, accepted.generationId);
  assert.equal(retried[0].inputMessage.id, accepted.inputMessage.id);
  assert.deepEqual(retried[1].changedKinds.sort(), KINDS, "the failed attempt never became a baseline");
  const messages = (await json<{ data: Message[] }>(await call(`${path}/messages`, owner.cookie))).data;
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
  const attempts = (await json<{ data: Generation[] }>(await call(`${path}/generations`, owner.cookie))).data;
  assert.deepEqual(attempts.map((g) => [g.id, g.status, g.inputMessageId]), [
    [retried[0].generationId, "completed", accepted.inputMessage.id],
    [accepted.generationId, "failed", accepted.inputMessage.id],
  ]);
  for (const id of [accepted.generationId, retried[0].generationId]) {
    await expectError(await call(`${path}/generations/${id}/retry`, owner.cookie, { method: "POST" }), 409, "RETRY_CONFLICT");
  }

  // A preparation failure is reported before any model call.
  await fixture.pool.query(`
    CREATE FUNCTION fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
    CREATE TRIGGER fail_snapshot BEFORE INSERT ON public.material_snapshots FOR EACH ROW EXECUTE FUNCTION fail_snapshot();
  `);
  await applications.update(fixture.pool, owner.id, (await fixture.pool.query("SELECT id FROM public.applications")).rows[0].id,
    undefined, { companyNotes: "Remote-first" });
  const refresh = await drain(sse(await call(`${path}/generations`, owner.cookie, { body: { content: "Any notes?" } })));
  assert.deepEqual(refresh.map((e) => e.type), ["generation.accepted", "generation.error"]);
  assert.deepEqual([refresh[1].stage, refresh[1].error.code, refresh[1].statePersisted], ["preparation", "MATERIAL_REFRESH_FAILED", true]);
  assert.equal(llm.streams.length, 2);
  await fixture.pool.query("DROP TRIGGER fail_snapshot ON public.material_snapshots");

  // A client disconnect aborts the model call, interrupts the run and saves no partial reply.
  llm.autoReply = null;
  const disconnect = new AbortController();
  const leaving = sse(await call(`${path}/generations/${refresh[0].generationId}/retry`, owner.cookie, { method: "POST", signal: disconnect.signal }));
  const leavingId = (await leaving.next())!.generationId as string;
  await leaving.next();
  const abandoned = await llm.next();
  abandoned.delta("partial answer");
  await leaving.next();
  disconnect.abort();
  await until(async () => (await generation(leavingId)).status === "interrupted");
  assert.equal(abandoned.aborted, true);
  assert.equal((await generation(leavingId)).error?.code, "GENERATION_INTERRUPTED");
  assert.equal((await fixture.pool.query("SELECT count(*)::int AS n FROM public.messages WHERE parts::text LIKE '%partial%'")).rows[0].n, 0);

  // A crash leaves an active run: startup recovery interrupts it, then retry works.
  const crashed = await acceptInput(fixture.pool, owner.id, conversationId, "Sent just before a crash");
  assert.equal(crashed.outcome, "ACCEPTED");
  await expectError(await call(`${path}/generations`, owner.cookie, { body: { content: "Blocked" } }), 409, "GENERATION_ACTIVE");
  assert.equal(await recoverAbandonedGenerations(fixture.pool), 1);
  const recoveredId = crashed.outcome === "ACCEPTED" ? crashed.generationId : "";
  assert.deepEqual([(await generation(recoveredId)).status, (await generation(recoveredId)).error?.code], ["interrupted", "GENERATION_INTERRUPTED"]);
  llm.autoReply = "Welcome back.";
  const resumed = await drain(sse(await call(`${path}/generations/${recoveredId}/retry`, owner.cookie, { method: "POST" })));
  assert.equal(resumed.at(-1)?.type, "generation.completed");
  const final = (await json<{ data: Message[] }>(await call(`${path}/messages`, owner.cookie))).data;
  assert.deepEqual(final.map((m) => [m.role, m.parts[0].text]), [
    ["user", "Mock interview, please."], ["assistant", "First question: why Acme?"],
    ["user", "Any notes?"], ["user", "Sent just before a crash"], ["assistant", "Welcome back."],
  ]);
});

test("without a model, reads work and a send answers 503 without saving input", { timeout: 60_000 }, async (t) => {
  const { fixture, call } = await startServer(t);
  const { owner, conversations: [conversationId] } = await seed(fixture, call);
  await expectError(await call(`/ai/conversations/${conversationId}/generations`, owner.cookie, { body: { content: "Hi" } }),
    503, "AI_SERVICE_UNAVAILABLE");
  assert.deepEqual(await json(await call(`/ai/conversations/${conversationId}/messages`, owner.cookie)), { data: [] });
  assert.deepEqual(await json(await call(`/ai/conversations/${conversationId}/generations`, owner.cookie)), { data: [] });
});
