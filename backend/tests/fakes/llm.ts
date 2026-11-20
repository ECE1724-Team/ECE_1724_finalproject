import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { createChatModel, DEFAULT_LIMITS, type ChatModelLimits } from "../../src/integrations/llm/openai.js";

/** One model call whose stream the test drives. */
export interface FakeStream {
  options: LanguageModelV4CallOptions;
  /** The text of the last user message in the request. */
  lastUserText: string;
  aborted: boolean;
  delta(text: string): void;
  finish(): void;
  fail(error?: unknown): void;
}

/**
 * A language model for tests, used through the real adapter (createChatModel). Each call waits
 * until the test feeds, fails or finishes it, unless `autoReply` is set.
 */
export class FakeLlm {
  readonly streams: FakeStream[] = [];
  autoReply: string | null = null;
  private pending: FakeStream[] = [];
  private waiters: ((stream: FakeStream) => void)[] = [];

  readonly model = new MockLanguageModelV4({
    provider: "fake",
    modelId: "fake-model",
    doStream: async (options) => {
      let controller!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
      const stream = new ReadableStream<LanguageModelV4StreamPart>({ start(c) { controller = c; } });
      let open = true;
      const lastUser = [...options.prompt].reverse().find((message) => message.role === "user");
      const handle: FakeStream = {
        options,
        lastUserText: lastUser?.content.flatMap((part) => part.type === "text" ? part.text : []).join("") ?? "",
        aborted: false,
        delta(text) { if (open) controller.enqueue({ type: "text-delta", id: "t", delta: text }); },
        finish() {
          if (!open) return;
          open = false;
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({
            type: "finish", finishReason: { unified: "stop", raw: "stop" },
            usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
          });
          controller.close();
        },
        fail(error = new Error("Injected model failure")) {
          if (!open) return;
          open = false;
          controller.enqueue({ type: "error", error });
          controller.close();
        },
      };
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "text-start", id: "t" });
      options.abortSignal?.addEventListener("abort", () => {
        handle.aborted = true;
        if (open) { open = false; controller.error(options.abortSignal!.reason); }
      }, { once: true });
      this.streams.push(handle);
      if (this.autoReply !== null) {
        handle.delta(this.autoReply);
        handle.finish();
      } else {
        const waiter = this.waiters.shift();
        if (waiter) waiter(handle);
        else this.pending.push(handle);
      }
      return { stream };
    },
  });

  chatModel(limits: ChatModelLimits = DEFAULT_LIMITS) {
    return createChatModel(this.model, limits);
  }

  /** The next test-driven call (auto-replied calls are skipped), waiting for it if needed. */
  next(): Promise<FakeStream> {
    const stream = this.pending.shift();
    return stream ? Promise.resolve(stream) : new Promise((resolve) => this.waiters.push(resolve));
  }
}
