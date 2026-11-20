import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { ModelTimeoutError, type ChatMessage } from "../../src/integrations/llm/openai.js";
import { FakeLlm } from "../fakes/llm.js";

const messages: ChatMessage[] = [
  { role: "system", content: "Rules" },
  { role: "system", content: "<materials></materials>" },
  { role: "user", content: "Hello" },
];
const limits = { maxOutputTokens: 2_000, idleMs: 1_000, totalMs: 5_000 };

test("a reply streams its deltas and reports usage; the request has both system parts and no tools", async () => {
  const fake = new FakeLlm();
  const deltas: string[] = [];
  const reply = fake.chatModel(limits).streamReply({ messages, signal: new AbortController().signal, onDelta: (d) => deltas.push(d) });
  const stream = await fake.next();
  stream.delta("Hi ");
  stream.delta("there");
  stream.finish();
  assert.deepEqual(await reply, { text: "Hi there", inputTokens: 10, outputTokens: 5, finishReason: "stop" });
  assert.deepEqual(deltas, ["Hi ", "there"]);
  assert.equal(stream.options.maxOutputTokens, 2_000);
  assert.equal(stream.options.tools, undefined);
  assert.deepEqual(stream.options.prompt.map((m) => m.role), ["system", "system", "user"]);
  assert.equal(stream.lastUserText, "Hello");
});

test("a model error, a caller abort and both timeouts reject the reply", async () => {
  const fake = new FakeLlm();
  const run = (overrides = {}, controller = new AbortController()) =>
    fake.chatModel({ ...limits, ...overrides }).streamReply({ messages, signal: controller.signal, onDelta: () => {} });

  const failing = run();
  (await fake.next()).fail();
  await assert.rejects(failing, /Injected model failure/);

  const controller = new AbortController();
  const aborted = run({}, controller);
  const abortedStream = await fake.next();
  abortedStream.delta("partial");
  controller.abort();
  await assert.rejects(aborted);
  assert.equal(abortedStream.aborted, true);

  const idle = run({ idleMs: 30 });
  const idleStream = await fake.next();
  await assert.rejects(idle, ModelTimeoutError);
  assert.equal(idleStream.aborted, true);

  // Steady progress does not reset the turn limit.
  const slow = run({ idleMs: 100, totalMs: 80 });
  const slowStream = await fake.next();
  const ticker = setInterval(() => slowStream.delta("."), 10);
  await assert.rejects(slow, ModelTimeoutError);
  clearInterval(ticker);

  const gone = new AbortController();
  gone.abort();
  await assert.rejects(run({}, gone));
  await sleep(0);
  assert.equal(fake.streams.length, 4, "an already aborted request makes no model call");
});
