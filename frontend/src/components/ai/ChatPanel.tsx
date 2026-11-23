import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import type { Components } from "react-markdown";
import { History, Loader2, MessageSquarePlus, RefreshCw, RotateCcw, SendHorizontal, Square } from "lucide-react";
import ErrorAlert from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getConversation, getMaterialSnapshot, listGenerations, listMessages, materialLabel, messageText, sortByKind,
  streamGeneration, unavailableReason,
} from "@/lib/ai";
import type { AiConversation, AiGeneration, AiGenerationMaterials, AiMessage, AiWorkspace } from "@/types";
import styles from "@/styles/ChatPanel.module.css";

type ChatPanelProps = {
  conversationId: string | null;
  workspace: AiWorkspace;
  creating: boolean;
  onNew: () => void;
  /** A turn started or ended: the conversation's title and order, or the current materials, may have changed. */
  onActivity: () => void;
};

type ChatState = { conversation: AiConversation; messages: AiMessage[]; generations: AiGeneration[] };

/** The reply being streamed in this tab. */
type LiveTurn = {
  /** The user's text until the server accepts it; null for a retry, whose message is already shown. */
  pendingText: string | null;
  generationId: string | null;
  synced: boolean;
  /** Materials that changed since the previous answer (empty on the first answer). */
  changedKinds: string[];
  text: string;
};

/** A turn that ended without a saved reply: its partial text (never saved) and error message. */
type Unfinished = { generationId: string; text: string; message: string | null };

// Shortcuts only fill in the input, which the user can edit before sending (PRD FR-25).
const SHORTCUTS = [
  { label: "Review my resume", prompt: "Review my resume against this job description: what matches, what is missing, and which bullets should I rewrite?" },
  { label: "Predict questions", prompt: "Predict the interview questions I am most likely to get for this role, with suggested answers based on my resume." },
  { label: "HR mock interview", prompt: "Run an HR mock interview for this role. Ask one question at a time and wait for my answer." },
  { label: "Technical mock interview", prompt: "Run a technical mock interview for this role. Ask one question at a time and wait for my answer." },
  { label: "Behavioral stories", prompt: "Build a behavioral (STAR) story bank from my resume for this role, and point out competencies I have no story for yet." },
  { label: "Feedback so far", prompt: "Give me feedback on my answers so far: what worked, what was missing, and a stronger version of each answer." },
];

const markdownComponents: Components = {
  a: ({ node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

// The Markdown parser is loaded with the first reply, so pages without chat don't download it.
const Markdown = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([import("react-markdown"), import("remark-gfm")]);
  return {
    default: ({ text }: { text: string }) => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</ReactMarkdown>
    ),
  };
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function readChat(conversationId: string, signal?: AbortSignal): Promise<ChatState> {
  const [conversation, messages, generations] = await Promise.all([
    getConversation(conversationId, signal),
    listMessages(conversationId, signal),
    listGenerations(conversationId, signal),
  ]);
  return { conversation, messages: messages.data, generations: generations.data };
}

export default function ChatPanel({ conversationId, workspace, creating, onNew, onActivity }: ChatPanelProps) {
  if (!conversationId) {
    return (
      <section className={styles.panel} aria-label="Chat">
        <div className={styles.placeholder}>
          <p>Start a conversation to get resume advice or practice an interview for this role.</p>
          <Button type="button" disabled={creating} onClick={onNew}>
            <MessageSquarePlus aria-hidden="true" />
            New conversation
          </Button>
        </div>
      </section>
    );
  }
  return <Chat conversationId={conversationId} workspace={workspace} onActivity={onActivity} />;
}

function Chat({ conversationId, workspace, onActivity }: { conversationId: string; workspace: AiWorkspace; onActivity: () => void }) {
  const [chat, setChat] = useState<ChatState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Leaving the conversation stops its reply; the server then marks the attempt interrupted.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    readChat(conversationId, controller.signal).then(setChat, (failure: unknown) => {
      if (!controller.signal.aborted) setLoadError(errorMessage(failure, "Failed to load the conversation."));
    });
    return () => controller.abort();
  }, [conversationId]);

  const messages = chat?.messages ?? [];
  const generations = chat?.generations ?? [];
  const lastUser = messages.findLast((message) => message.role === "user");
  // Attempts are listed newest first, so this is the latest message's most recent attempt.
  const lastAttempt = lastUser && generations.find((generation) => generation.inputMessageId === lastUser.id);
  const busyElsewhere = !live && generations.some((generation) => generation.status === "preparing" || generation.status === "streaming");
  const retryable = !live && (lastAttempt?.status === "failed" || lastAttempt?.status === "interrupted") ? lastAttempt : null;
  const canSend = chat !== null && !live && !busyElsewhere && draft.trim() !== "";

  // A reply still running (in another tab, or one this tab just stopped) ends on its own; check again shortly.
  useEffect(() => {
    if (!busyElsewhere) return;
    const timer = window.setTimeout(() => {
      readChat(conversationId).then(setChat, () => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [busyElsewhere, chat, conversationId]);

  // Follow new text only while the user is reading the end of the conversation.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [chat, live, unfinished]);

  async function refresh() {
    setSendError(null);
    try {
      setChat(await readChat(conversationId));
    } catch (failure) {
      setSendError(errorMessage(failure, "Failed to reload the conversation."));
    }
  }

  async function run(input: { content: string } | { retryGenerationId: string }) {
    const controller = new AbortController();
    abortRef.current = controller;
    stickToBottom.current = true;
    setSendError(null);
    setUnfinished(null);
    setLive({ pendingText: "content" in input ? input.content : null, generationId: null, synced: false, changedKinds: [], text: "" });
    const turn = { generationId: null as string | null, text: "", failure: null as string | null, completed: false };

    try {
      await streamGeneration(conversationId, input, (event) => {
        switch (event.type) {
          case "generation.accepted":
            turn.generationId = event.generationId;
            if ("content" in input) setDraft("");
            setChat((current) => current && !current.messages.some((message) => message.id === event.inputMessage.id)
              ? { ...current, messages: [...current.messages, event.inputMessage] }
              : current);
            setLive((current) => current && { ...current, pendingText: null, generationId: event.generationId });
            onActivity();
            break;
          case "materials.synced":
            setLive((current) => current && {
              ...current, synced: true, changedKinds: event.baselineGenerationId ? event.changedKinds : [],
            });
            break;
          case "text.delta":
            turn.text += event.delta;
            setLive((current) => current && { ...current, text: current.text + event.delta });
            break;
          case "generation.completed":
            turn.completed = true;
            break;
          case "generation.error":
            turn.failure = event.error.message;
            break;
        }
      }, controller.signal);
    } catch (failure) {
      // Rejected before the stream opened (409, 503, ...) keeps the draft. After acceptance, a
      // dropped stream or Stop is resolved from the saved state below.
      if (!turn.generationId && !controller.signal.aborted) setSendError(errorMessage(failure, "Failed to send the message."));
    }
    abortRef.current = null;
    if (!mountedRef.current) return;

    if (!turn.completed && turn.generationId) {
      setUnfinished({ generationId: turn.generationId, text: turn.text, message: turn.failure });
    }
    // The saved state decides what comes next: the saved reply, a retry, or a reply still finishing.
    try {
      const next = await readChat(conversationId);
      if (!mountedRef.current) return;
      setChat(next);
    } catch (failure) {
      if (!mountedRef.current) return;
      setSendError(errorMessage(failure, "Failed to reload the conversation."));
    }
    setLive(null);
    onActivity();
  }

  function send() {
    if (canSend) void run({ content: draft.trim() });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an input method is composing (e.g. Chinese) only confirms the candidate.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function prefill(prompt: string) {
    setDraft(prompt);
    inputRef.current?.focus();
  }

  const generationOf = (message: AiMessage) => generations.find((generation) => generation.id === message.generationId);

  return (
    <section className={styles.panel} aria-label="Chat">
      <div
        ref={scrollRef}
        className={styles.messages}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        {loadError ? (
          <ErrorAlert message={loadError} />
        ) : !chat ? (
          <p role="status" className={styles.placeholder}>Loading conversation...</p>
        ) : (
          <>
            {messages.length === 0 && !live && (
              <div className={styles.welcome}>
                <p className={styles.welcomeTitle}>
                  How can I help you prepare for {workspace.jobTitle} at {workspace.companyName}?
                </p>
                <p>
                  Pick a shortcut below to fill in a request, edit it if you like, then send. You can also ask anything
                  about this role or start a mock interview.
                </p>
              </div>
            )}

            {messages.map((message, index) => {
              if (message.role === "user") {
                const unanswered = message.id !== lastUser?.id && messages[index + 1]?.role !== "assistant";
                return (
                  <div key={message.id} className={styles.userRow}>
                    <p className={styles.user}>{messageText(message)}</p>
                    {unanswered && <p className={styles.note}>No reply was saved for this message.</p>}
                  </div>
                );
              }
              if (message.role !== "assistant") return null; // website-tool records are not shown yet
              return (
                <AssistantMessage
                  key={message.id}
                  conversationId={conversationId}
                  message={message}
                  generation={generationOf(message)}
                  workspace={workspace}
                />
              );
            })}

            {live?.pendingText && (
              <div className={styles.userRow}><p className={styles.user}>{live.pendingText}</p></div>
            )}

            {live && (
              <article className={styles.assistant}>
                {live.changedKinds.length > 0 && <MaterialsChanged kinds={live.changedKinds} />}
                {live.text ? (
                  <div className={styles.bubble}><MarkdownText text={live.text} /></div>
                ) : (
                  <p role="status" className={styles.status}>
                    <Loader2 aria-hidden="true" className={styles.spinner} />
                    {!live.generationId ? "Sending..." : !live.synced ? "Reading your materials..." : "Writing a reply..."}
                  </p>
                )}
              </article>
            )}

            {retryable && (
              <div className={styles.failure}>
                {unfinished?.generationId === retryable.id && unfinished.text && (
                  <div className={styles.partial}>
                    <MarkdownText text={unfinished.text} />
                    <p className={styles.note}>Partial reply. It was not saved.</p>
                  </div>
                )}
                <ErrorAlert
                  message={(unfinished?.generationId === retryable.id && unfinished.message)
                    || retryable.error?.message
                    || "The reply did not finish."}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => void run({ retryGenerationId: retryable.id })}>
                  <RotateCcw aria-hidden="true" />
                  Retry
                </Button>
              </div>
            )}

            {busyElsewhere && (
              <div role="status" className={styles.status}>
                <Loader2 aria-hidden="true" className={styles.spinner} />
                A reply is still in progress for this conversation. This view updates when it ends.
                <Button type="button" variant="ghost" size="xs" onClick={() => void refresh()}>Refresh</Button>
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.composer}>
        {sendError && <ErrorAlert message={sendError} />}
        <div className={styles.shortcuts}>
          {SHORTCUTS.map((shortcut) => (
            <Button
              key={shortcut.label}
              type="button"
              variant="outline"
              size="sm"
              disabled={!chat}
              onClick={() => prefill(shortcut.prompt)}
            >
              {shortcut.label}
            </Button>
          ))}
        </div>
        <div className={styles.inputRow}>
          <Textarea
            ref={inputRef}
            aria-label="Message"
            rows={2}
            placeholder="Ask about this role, or answer the interviewer..."
            value={draft}
            className={styles.input}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {live ? (
            <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
              <Square aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button type="button" disabled={!canSend} onClick={send}>
              <SendHorizontal aria-hidden="true" />
              Send
            </Button>
          )}
        </div>
        <p className={styles.hint}>Enter to send, Shift+Enter for a new line. AI replies can be wrong; check important details.</p>
      </div>
    </section>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Suspense fallback={<p className={styles.plain}>{text}</p>}>
        <Markdown text={text} />
      </Suspense>
    </div>
  );
}

function MaterialsChanged({ kinds }: { kinds: string[] }) {
  return (
    <p className={styles.notice}>
      <RefreshCw aria-hidden="true" />
      Updated before this reply: {sortByKind(kinds.map((kind) => ({ kind }))).map(({ kind }) => materialLabel(kind)).join(", ")}.
      The reply uses the new versions.
    </p>
  );
}

function AssistantMessage({ conversationId, message, generation, workspace }: {
  conversationId: string;
  message: AiMessage;
  generation: AiGeneration | undefined;
  workspace: AiWorkspace;
}) {
  const materials = generation?.materials ?? null;
  // The first answer of a conversation has no baseline, so every material counts as new; don't announce that.
  const changed = generation?.baselineGenerationId ? generation.changedKinds ?? [] : [];
  const outdated = materials
    ? sortByKind(Object.values(materials)).filter((material) =>
      workspace.materials[material.kind] && workspace.materials[material.kind].fingerprint !== material.fingerprint)
    : [];

  return (
    <article className={styles.assistant}>
      {changed.length > 0 && <MaterialsChanged kinds={changed} />}
      <div className={styles.bubble}>
        <MarkdownText text={messageText(message)} />
      </div>
      <div className={styles.meta}>
        <time dateTime={message.createdAt}>
          {new Date(message.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </time>
        {outdated.length > 0 && (
          <span className={styles.outdated}>
            <History aria-hidden="true" />
            Based on earlier materials: {outdated.map((material) => materialLabel(material.kind)).join(", ")}
          </span>
        )}
      </div>
      {materials && <MaterialsUsed conversationId={conversationId} materials={materials} workspace={workspace} />}
    </article>
  );
}

/** The exact material text an answer was given, loaded when first opened. */
function MaterialsUsed({ conversationId, materials, workspace }: {
  conversationId: string;
  materials: AiGenerationMaterials;
  workspace: AiWorkspace;
}) {
  const [texts, setTexts] = useState<Record<string, string | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = sortByKind(Object.values(materials));

  async function load() {
    if (texts) return;
    setError(null);
    try {
      const loaded = await Promise.all(items.map(async (item) => [
        item.kind,
        item.availability === "available" ? (await getMaterialSnapshot(conversationId, item.snapshotId)).contentText : null,
      ] as const));
      setTexts(Object.fromEntries(loaded));
    } catch (failure) {
      setError(errorMessage(failure, "Failed to load the materials."));
    }
  }

  // Resume files never change, so the source resume ID tells whether this was the resume linked now.
  function resumeName(sourceResumeId: string | null) {
    if (!sourceResumeId) return null;
    return workspace.linkedResume?.id === sourceResumeId ? workspace.linkedResume.name : "an earlier resume";
  }

  return (
    <details className={styles.materials} onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
      <summary>Materials used for this reply</summary>
      {error && <ErrorAlert message={error} />}
      <dl className={styles.materialList}>
        {items.map((item) => {
          const name = item.kind === "resume" ? resumeName(item.sourceResumeId) : null;
          return (
            <div key={item.kind}>
              <dt>
                {materialLabel(item.kind)}
                {name && <span className={styles.materialDetail}> · {name}</span>}
                {item.availability !== "available" && (
                  <span className={styles.materialDetail}> · {unavailableReason(item.reasonCode)}</span>
                )}
              </dt>
              {item.availability === "available" && (
                <dd className={styles.materialText}>{texts ? texts[item.kind] : error ? "" : "Loading..."}</dd>
              )}
            </div>
          );
        })}
      </dl>
    </details>
  );
}
