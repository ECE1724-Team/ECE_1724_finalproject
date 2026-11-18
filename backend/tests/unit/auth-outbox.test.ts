import assert from "node:assert/strict";
import test from "node:test";
import type { PendingCredential } from "../../src/modules/auth/credentials.js";
import type { AuthReportCode } from "../../src/modules/auth/errors.js";
import { createEmailOutbox } from "../../src/modules/auth/outbox.js";

function job(n: number): PendingCredential {
  return {
    to: `user-${n}@example.test`, url: `http://localhost:3000/verify?n=${n}`, purpose: "email_verification",
    expiresAt: new Date(Date.now() + 900_000), userId: `user-${n}`, issuanceId: `issuance-${n}`,
    sequence: String(n), token: `token-${n}`, issuedAt: new Date(),
  };
}

/** A promise the test resolves or rejects by hand. */
function gate() {
  let open!: () => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => { open = resolve; fail = reject; });
  return { promise, open, fail };
}

test("at most `concurrency` emails are in flight, and drain waits for queued ones too", async () => {
  const gates = [gate(), gate(), gate()];
  let inFlight = 0;
  let peak = 0;
  const sent: string[] = [];
  const outbox = createEmailOutbox({
    concurrency: 2,
    report: () => assert.fail("nothing should fail"),
    send: async (credential) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gates[Number(credential.sequence)]!.promise;
      inFlight -= 1;
      sent.push(credential.sequence);
    },
    activate: async () => {},
  });
  [0, 1, 2].forEach((n) => outbox.enqueue(job(n)));
  let drained = false;
  const draining = outbox.drain().then(() => { drained = true; });

  gates[1]!.open();
  gates[0]!.open();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false, "job 2 is still waiting for a slot");
  gates[2]!.open();
  await draining;

  assert.equal(peak, 2);
  assert.deepEqual(sent.sort(), ["0", "1", "2"]);
});

test("a rejected send is reported as delivery failure and never activates the link", async () => {
  const reports: AuthReportCode[] = [];
  let activated = 0;
  const outbox = createEmailOutbox({
    report: (code) => { reports.push(code); },
    send: async () => { throw new Error("550 mailbox unavailable"); },
    activate: async () => { activated += 1; },
  });
  outbox.enqueue(job(1));
  await outbox.drain();
  assert.deepEqual(reports, ["AUTH_EMAIL_DELIVERY_FAILED"]);
  assert.equal(activated, 0);
});

test("an accepted send whose activation fails is reported separately", async () => {
  const reports: AuthReportCode[] = [];
  const outbox = createEmailOutbox({
    report: (code) => { reports.push(code); },
    send: async () => {},
    activate: async () => { throw new Error("database down"); },
  });
  outbox.enqueue(job(1));
  outbox.enqueue(job(2));
  await outbox.drain();
  assert.deepEqual(reports, ["AUTH_CREDENTIAL_ACTIVATION_FAILED", "AUTH_CREDENTIAL_ACTIVATION_FAILED"]);
});

test("drain on an empty queue resolves immediately; concurrency must be positive", async () => {
  const outbox = createEmailOutbox({ report: () => {}, send: async () => {}, activate: async () => {} });
  await outbox.drain();
  assert.throws(() => createEmailOutbox({ report: () => {}, send: async () => {}, activate: async () => {}, concurrency: 0 }));
});
