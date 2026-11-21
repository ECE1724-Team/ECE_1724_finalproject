import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type LanguageModel } from "ai";

// Text streaming for AI replies (Vercel AI SDK). The core chat request has no tools. Credentials come
// from the server environment; prompts, replies and keys are never logged here.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ReplyResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string;
}

export interface ChatModel {
  readonly provider: string;
  readonly modelId: string;
  /** Streams one reply. Rejects on a model error, a timeout, or when `signal` aborts. */
  streamReply(request: { messages: ChatMessage[]; signal: AbortSignal; onDelta: (delta: string) => void }): Promise<ReplyResult>;
  /** An internal history summary: the same call with the smaller summary output cap. */
  summarize(request: { messages: ChatMessage[]; signal: AbortSignal }): Promise<ReplyResult>;
}

export interface ChatModelLimits {
  maxOutputTokens: number;
  summaryOutputTokens: number;
  /** Cancel when the stream makes no progress for this long. */
  idleMs: number;
  /** Cancel when the whole reply takes longer than this. */
  totalMs: number;
}

export const DEFAULT_LIMITS: ChatModelLimits = { maxOutputTokens: 4_000, summaryOutputTokens: 800, idleMs: 30_000, totalMs: 120_000 };

export class ModelTimeoutError extends Error {
  constructor() {
    super("The model stream timed out");
    this.name = "ModelTimeoutError";
  }
}

export function createChatModel(model: Exclude<LanguageModel, string>, limits: ChatModelLimits = DEFAULT_LIMITS): ChatModel {
  return {
    provider: model.provider,
    modelId: model.modelId,
    streamReply: ({ messages, signal, onDelta }) => run(messages, signal, limits.maxOutputTokens, onDelta),
    summarize: ({ messages, signal }) => run(messages, signal, limits.summaryOutputTokens, () => {}),
  };

  async function run(messages: ChatMessage[], signal: AbortSignal, maxOutputTokens: number, onDelta: (delta: string) => void)
    : Promise<ReplyResult> {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timeout = () => { timedOut = true; controller.abort(new ModelTimeoutError()); };
    const total = setTimeout(timeout, limits.totalMs);
    let idle = setTimeout(timeout, limits.idleMs);
    try {
      const result = streamText({
        model, messages, allowSystemInMessages: true,
        maxOutputTokens, abortSignal: controller.signal,
        // The default handler logs the whole error, whose request body holds the prompt. The error
        // part below is handled instead.
        onError: () => {},
      });
      let text = "";
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          clearTimeout(idle);
          idle = setTimeout(timeout, limits.idleMs);
          text += part.text;
          onDelta(part.text);
        } else if (part.type === "error") {
          throw part.error;
        } else if (part.type === "abort") {
          throw timedOut ? new ModelTimeoutError() : (signal.reason ?? new Error("Model stream aborted"));
        } else if (part.type === "finish") {
          if (part.finishReason === "error" || !text.trim()) throw new Error(`Model finished without a reply (${part.finishReason})`);
          return {
            text,
            inputTokens: part.totalUsage.inputTokens ?? null,
            outputTokens: part.totalUsage.outputTokens ?? null,
            finishReason: part.finishReason,
          };
        }
      }
      throw new Error("Model stream ended without finishing");
    } catch (error) {
      throw timedOut ? new ModelTimeoutError() : error;
    } finally {
      clearTimeout(total);
      clearTimeout(idle);
      signal.removeEventListener("abort", abort);
    }
  }
}

export function createOpenAiChatModel(config: { apiKey: string; model: string }): ChatModel {
  return createChatModel(createOpenAI({ apiKey: config.apiKey })(config.model));
}
