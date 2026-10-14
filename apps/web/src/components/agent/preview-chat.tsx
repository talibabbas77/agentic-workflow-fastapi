"use client";

import type { ChatMessage, Conversation, ConversationMode, TicketType } from "@docent/api-client";
import { ArrowCounterClockwiseIcon, ChatCircleTextIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { api, request } from "@/lib/api/browser";
import { sendTurn, type TurnStage } from "@/lib/api/turn";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { ChatMessageItem } from "./chat-message";
import { claimProblems, claimsObject, ClaimsEditor, type ClaimRow } from "./claims-editor";
import { HandoffCard, HandoffNote } from "./handoff-card";

const MAX_LENGTH = 2000;
const COUNT_FROM = 1800;
/** Stop asking for a handoff summary after this long; the person can ask again. */
const SUMMARY_PATIENCE_MS = 180_000;

const modes = [
  { value: "anonymous", label: "Anonymous visitor" },
  { value: "identified", label: "Signed-in customer" },
] as const satisfies readonly { value: ConversationMode; label: string }[];

type Stage = "sending" | TurnStage;

const stageText: Record<Stage, string> = {
  sending: "Sending your message",
  searching: "Searching your sources",
  writing: "Writing an answer",
  checking: "Checking sources",
};

/**
 * Chat with the agent as a customer would. The conversation starts with the
 * first message, using the mode and customer details chosen above it; both are
 * fixed from then on, like a real widget session.
 */
export function PreviewChat({ ticketTypes }: { ticketTypes: TicketType[] }) {
  const inputId = useId();
  const [mode, setMode] = useState<ConversationMode>("anonymous");
  const [claims, setClaims] = useState<ClaimRow[]>([{ id: 1, key: "plan", value: "Pro" }]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // The escalation whose summary is overdue, so polling for it stopped.
  const [lateFor, setLateFor] = useState<string | null>(null);
  const turn = useRef<AbortController | null>(null);
  const activeId = useRef<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const running = stage !== null;
  const started = conversation !== null || running;
  const escalation = conversation?.escalation ?? null;
  const waiting = Boolean(escalation && !escalation.summary);
  const late = waiting && lateFor !== null && lateFor === escalation?.id;
  const lastHandoff = messages.findLastIndex((m) => m.decision?.type === "escalate");

  const load = useCallback(async (id: string) => {
    const result = await request(
      api.GET("/v1/agent/conversations/{conversation_id}", { params: { path: { conversation_id: id } } }),
    );
    // Ignore an answer for a conversation that was reset meanwhile.
    if (result.ok && activeId.current === id) setConversation(result.data);
  }, []);

  // The summary is written by a background job a few seconds after the handoff.
  usePoll(waiting && !late, async () => {
    if (conversation) await load(conversation.id);
  }, 3000);

  const escalationId = escalation?.id;
  useEffect(() => {
    if (!waiting || late || !escalationId) return;
    const timer = window.setTimeout(() => setLateFor(escalationId), SUMMARY_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, late, escalationId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // Keep the newest message and the progress line in view.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, stage, error, escalation?.summary]);

  useEffect(() => () => turn.current?.abort(), []);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || running) return;
    if (!conversation && mode === "identified" && claimProblems(claims).size > 0) {
      setError("Fix the customer details above, then send again.");
      return;
    }

    const controller = new AbortController();
    turn.current = controller;
    const visitor: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "visitor",
      content,
      decision: null,
      citations: [],
      created_at: null,
    };
    setError(null);
    setElapsed(0);
    setStage("sending");
    setDraft("");
    setMessages((list) => [...list, visitor]);

    const fail = (message: string, stored: boolean) => {
      turn.current = null;
      setStage(null);
      setError(message);
      // Nothing was saved, so put the question back for another try.
      if (!stored) {
        setMessages((list) => list.filter((m) => m.id !== visitor.id));
        setDraft(content);
      }
    };

    let current = conversation;
    if (!current) {
      const created = await request(
        api.POST("/v1/agent/conversations", {
          body: { mode, claims: mode === "identified" ? claimsObject(claims) : {} },
        }),
      );
      if (controller.signal.aborted) return;
      if (!created.ok) return fail(created.error.message, false);
      current = created.data;
      activeId.current = current.id;
      setConversation(current);
    }

    const result = await sendTurn(
      current.id,
      content,
      (next) => {
        if (!controller.signal.aborted) setStage(next);
      },
      controller.signal,
    );
    if (result.kind === "aborted") return;
    if (result.kind === "failed") {
      fail(result.message, result.stored);
    } else {
      turn.current = null;
      setStage(null);
      setMessages((list) => [...list, result.message]);
      if (result.message.decision?.type === "escalate") {
        // Drop an earlier handoff so its summary never shows on this one while it loads.
        setConversation((c) => (c ? { ...c, escalation: null } : c));
        await load(current.id);
      }
    }
    requestAnimationFrame(() => input.current?.focus());
  }

  function reset() {
    turn.current?.abort();
    turn.current = null;
    activeId.current = null;
    setConversation(null);
    setMessages([]);
    setStage(null);
    setError(null);
    setDraft("");
    setLateFor(null);
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  }

  return (
    <Card aria-labelledby="preview-heading" className="flex min-w-0 flex-col">
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle id="preview-heading">Preview</CardTitle>
          <CardDescription>
            Ask what your customers ask. The agent answers from your sources with the settings on this page.
          </CardDescription>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 self-start"
          disabled={!started}
          onClick={reset}
          icon={<ArrowCounterClockwiseIcon aria-hidden="true" className="size-4" />}
        >
          New conversation
        </Button>
      </CardHeader>

      <div className="flex flex-col gap-4 border-b border-line px-6 py-4">
        <SegmentedControl
          legend="Asking as"
          name="preview-mode"
          value={mode}
          options={modes}
          onChange={setMode}
          disabled={started}
          hint={started ? "Start a new conversation to change who is asking." : undefined}
        />
        {mode === "identified" ? <ClaimsEditor rows={claims} onChange={setClaims} locked={started} /> : null}
      </div>

      {/* On laptops the log fills the screen below the page header, so the input stays in view. */}
      <div
        ref={log}
        role="log"
        aria-label="Conversation"
        tabIndex={0}
        className="flex h-[clamp(20rem,calc(100dvh-35.5rem),40rem)] flex-col gap-5 overflow-y-auto px-6 py-5"
      >
        {messages.length === 0 ? (
          <EmptyChat />
        ) : (
          <ol aria-label="Messages" className="flex flex-col gap-5">
            {messages.map((message, index) => (
              <ChatMessageItem key={message.id} message={message}>
                {message.decision?.type !== "escalate" ? null : index === lastHandoff ? (
                  <HandoffCard
                    reason={message.decision.reason}
                    escalation={escalation}
                    ticketTypes={ticketTypes}
                    late={late}
                    onCheckAgain={() => {
                      setLateFor(null);
                      if (conversation) void load(conversation.id);
                    }}
                  />
                ) : (
                  <HandoffNote reason={message.decision.reason} />
                )}
              </ChatMessageItem>
            ))}
          </ol>
        )}
        {stage ? (
          <p className="flex items-center gap-2.5 self-start rounded-md border border-dashed border-line-strong px-3.5 py-2.5 text-base text-ink">
            <span aria-hidden="true" className="spinner text-xs text-rust" />
            {stageText[stage]}
            {elapsed >= 2 ? (
              <span aria-hidden="true" className="text-sm text-ink-muted tabular-nums">
                {elapsed} s
              </span>
            ) : null}
          </p>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>

      <form onSubmit={send} noValidate className="flex flex-col gap-2 border-t border-line px-6 py-4">
        <label htmlFor={inputId} className="sr-only">
          Message
        </label>
        <div className="flex items-end gap-2">
          <Textarea
            ref={input}
            id={inputId}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={running}
            maxLength={MAX_LENGTH}
            placeholder="Ask a question"
            className="max-h-40 min-h-10 resize-none field-sizing-content"
          />
          <Button
            type="submit"
            loading={running}
            disabled={!draft.trim()}
            className="shrink-0"
            icon={<PaperPlaneRightIcon aria-hidden="true" className="size-4" />}
          >
            Send
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span>Enter sends. Shift and Enter adds a line.</span>
          {draft.length >= COUNT_FROM ? (
            <span className={cn("tabular-nums", draft.length >= MAX_LENGTH && "text-rust")}>
              {formatCount(draft.length)} of {formatCount(MAX_LENGTH)}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function EmptyChat() {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-2 text-center">
      <span
        aria-hidden="true"
        className="mb-1 inline-flex size-10 items-center justify-center rounded-md border border-line bg-paper text-ink-muted"
      >
        <ChatCircleTextIcon className="size-5" />
      </span>
      <p className="text-md font-medium text-ink">Ask something your customers ask</p>
      <p className="text-sm text-ink-muted">
        The agent answers only from your sources and cites them. When it cannot, it hands the conversation to your
        team.
      </p>
    </div>
  );
}
