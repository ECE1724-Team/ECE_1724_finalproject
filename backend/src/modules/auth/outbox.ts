import type { AuthReportCode } from "./errors.js";
import type { PendingCredential } from "./credentials.js";

export interface EmailOutbox {
  /** Queues a credential prepared by a committed request. Never throws. */
  enqueue(job: PendingCredential): void;
  /** Resolves once every queued and running job has finished (tests, shutdown). */
  drain(): Promise<void>;
}

export interface EmailOutboxOptions {
  /** Resolves when SMTP accepts the message. */
  send(job: PendingCredential): Promise<void>;
  /** Makes the accepted link the current one (its own short transaction). */
  activate(job: PendingCredential): Promise<void>;
  report(code: AuthReportCode): void;
  /** Concurrent SMTP sends. Default 2. */
  concurrency?: number;
}

/**
 * In-process queue for auth emails. A job runs only after its request transaction committed,
 * outside every database lock. SMTP acceptance gates activation: a failed send leaves the
 * previous link active. The queue is not durable; a crash loses queued jobs, and the user
 * requests another email (Database Design Appendix E.3).
 */
export function createEmailOutbox({ send, activate, report, concurrency = 2 }: EmailOutboxOptions): EmailOutbox {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("Email concurrency must be a positive integer");
  const waiting: PendingCredential[] = [];
  const running = new Set<Promise<void>>();

  async function deliver(job: PendingCredential): Promise<void> {
    try {
      await send(job);
    } catch {
      report("AUTH_EMAIL_DELIVERY_FAILED");
      return;
    }
    try {
      await activate(job);
    } catch {
      report("AUTH_CREDENTIAL_ACTIVATION_FAILED");
    }
  }

  function pump(): void {
    while (running.size < concurrency && waiting.length) {
      const job = waiting.shift()!;
      const work: Promise<void> = deliver(job).finally(() => {
        running.delete(work);
        pump();
      });
      running.add(work);
    }
  }

  return {
    enqueue(job) {
      waiting.push(job);
      pump();
    },
    async drain() {
      while (running.size || waiting.length) await Promise.all([...running]);
    },
  };
}
