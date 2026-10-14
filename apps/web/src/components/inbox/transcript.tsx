"use client";

import type { EmailDelivery, HandoffReason, InboxMessage, MessageFeedback } from "@docent/api-client";
import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  HeadsetIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { confidenceLabel, MessageText, Source } from "@/components/agent/chat-message";
import { AddToEvalSet } from "@/components/evals/add-to-eval-set";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatRelative, plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { reasonLabel } from "./inbox-meta";

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

/**
 * The conversation as the customer had it. The customer is on the left; the
 * agent and your team on the right. Agent answers keep their sources and the
 * customer's own "Was this helpful?" vote, and any of them can be marked as
 * wrong. With `evalConversationId`, owners and admins can also turn any agent
 * answer into a test case; on an answer the customer voted down, that offer
 * sits with their note.
 */
export function Transcript({
  messages,
  customer,
  reason,
  onChange,
  evalConversationId,
}: {
  messages: InboxMessage[];
  customer: string;
  reason: HandoffReason;
  onChange: (message: InboxMessage) => void;
  evalConversationId?: string;
}) {
  const [flagging, setFlagging] = useState<InboxMessage | null>(null);
  // The handoff happened at the first agent message that escalated.
  const handoffAt = messages.find((m) => m.role === "agent" && m.decision?.type === "escalate")?.id;

  return (
    <>
      <ol aria-label="Conversation" className="flex flex-col gap-5">
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            customer={customer}
            handoff={message.id === handoffAt ? reason : null}
            onFlag={() => setFlagging(message)}
            onChange={onChange}
            evalConversationId={evalConversationId}
          />
        ))}
      </ol>
      <FlagDialog target={flagging} onClose={() => setFlagging(null)} onFlagged={onChange} />
    </>
  );
}

function Label({ who, at, extra }: { who: string; at: string; extra?: string | null }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted">
      <span className="font-medium text-ink">{who}</span>
      <time dateTime={at} className="tabular-nums">
        {timeFormat.format(new Date(at))} UTC
      </time>
      {extra ? <span>{extra}</span> : null}
    </p>
  );
}

function MessageRow({
  message,
  customer,
  handoff,
  onFlag,
  onChange,
  evalConversationId,
}: {
  message: InboxMessage;
  customer: string;
  handoff: HandoffReason | null;
  onFlag: () => void;
  onChange: (message: InboxMessage) => void;
  evalConversationId?: string;
}) {
  if (message.role === "system") {
    return (
      <li dir="auto" className="text-center text-sm text-ink-muted">
        {message.content}
      </li>
    );
  }
  if (message.role === "visitor") {
    return (
      <li className="flex flex-col items-start gap-1.5">
        <Label who={customer} at={message.created_at} />
        <p
          dir="auto"
          className="max-w-[85%] rounded-md bg-surface-2 px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-ink"
        >
          {message.content}
        </p>
      </li>
    );
  }
  if (message.role === "human") {
    return (
      <li className="flex flex-col items-end gap-1.5">
        <Label who={message.author?.name ?? "Your team"} at={message.created_at} extra="Reply by email" />
        <p
          dir="auto"
          className="max-w-[85%] rounded-md border border-rust/25 bg-rust-soft px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-ink"
        >
          {message.content}
        </p>
        {message.delivery ? <DeliveryLine delivery={message.delivery} /> : null}
      </li>
    );
  }
  return (
    <>
      <AgentMessage
        message={message}
        customer={customer}
        onFlag={onFlag}
        onChange={onChange}
        evalConversationId={evalConversationId}
      />
      {handoff ? (
        <li role="separator" className="flex items-center gap-3 text-sm text-ink-muted">
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
          <span className="inline-flex items-center gap-1.5">
            <HeadsetIcon aria-hidden="true" className="size-4 text-rust" />
            Handed to your team: {reasonLabel[handoff].toLowerCase()}
          </span>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </li>
      ) : null}
    </>
  );
}

function AgentMessage({
  message,
  customer,
  onFlag,
  onChange,
  evalConversationId,
}: {
  message: InboxMessage;
  customer: string;
  onFlag: () => void;
  onChange: (message: InboxMessage) => void;
  evalConversationId?: string;
}) {
  const now = useNow();
  const sourcesId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);
  const decision = message.decision;
  const conversational = decision?.type === "reply";
  const citations = conversational ? [] : message.citations;
  const confidence = decision?.type === "answer" ? decision.confidence : null;
  const sourceId = (marker: number) => `${sourcesId}-${marker}`;
  const votedDown = message.feedback?.vote === "down";

  function cite(marker: number) {
    setOpen(true);
    setActive(marker);
    requestAnimationFrame(() => document.getElementById(sourceId(marker))?.focus());
  }

  async function undo() {
    setUndoing(true);
    const result = await request(
      api.DELETE("/v1/messages/{message_id}/flag", { params: { path: { message_id: message.id } } }),
    );
    setUndoing(false);
    if (result.ok) onChange(result.data);
  }

  return (
    <li className="flex flex-col items-end gap-1.5">
      <Label who="Agent" at={message.created_at} extra={confidence ? confidenceLabel[confidence] : null} />
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-2 rounded-md border bg-paper px-3.5 py-2.5 text-base break-words text-ink",
          message.flag ? "border-rust" : "border-line",
        )}
      >
        <MessageText text={message.content} citations={citations} onCite={cite} />
      </div>
      <div className="flex w-full max-w-[85%] flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-ink-muted">
          {citations.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={sourcesId}
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-sm font-medium transition-colors duration-150 hover:text-ink"
            >
              <CaretRightIcon
                aria-hidden="true"
                className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
                weight="bold"
              />
              {citations.length} {plural(citations.length, "source")}
            </button>
          ) : null}
          {decision?.account_facts && decision.account_facts.length > 0 ? (
            <span>
              From customer details: <span className="font-mono text-ink">{decision.account_facts.join(", ")}</span>
            </span>
          ) : null}
          {message.flag ? null : (
            <button
              type="button"
              onClick={onFlag}
              className="inline-flex items-center gap-1 rounded-sm font-medium transition-colors duration-150 hover:text-rust"
            >
              <ThumbsDownIcon aria-hidden="true" className="size-3.5" />
              Mark as wrong
            </button>
          )}
          {evalConversationId && !conversational && !votedDown ? (
            <AddToEvalSet compact conversationId={evalConversationId} messageId={message.id} />
          ) : null}
        </div>
        {citations.length > 0 ? (
          <ol id={sourcesId} aria-label="Sources" hidden={!open} className="flex w-full flex-col gap-2">
            {[...citations]
              .sort((a, b) => a.marker - b.marker)
              .map((citation) => (
                <Source
                  key={citation.marker}
                  id={sourceId(citation.marker)}
                  citation={citation}
                  active={active === citation.marker}
                />
              ))}
          </ol>
        ) : null}
        {message.feedback ? (
          <CustomerVote
            feedback={message.feedback}
            customer={customer}
            addToEvalSet={
              votedDown && evalConversationId ? (
                <AddToEvalSet compact conversationId={evalConversationId} messageId={message.id} />
              ) : null
            }
          />
        ) : null}
        {message.flag ? (
          <div className="flex w-full items-start gap-2.5 rounded-md border border-rust/40 bg-rust-soft px-3 py-2.5 text-sm">
            <ThumbsDownIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rust" weight="bold" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="font-medium text-ink">Marked as a wrong answer</p>
              <p dir="auto" className="break-words text-ink">
                {message.flag.reason}
              </p>
              <p className="text-ink-muted">
                {message.flag.by ?? "A teammate"}, {formatRelative(message.flag.at, now)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              loading={undoing}
              className="-my-1 -mr-1.5 h-7 px-2"
              icon={<ArrowCounterClockwiseIcon aria-hidden="true" className="size-4" />}
              onClick={undo}
            >
              Undo
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** What the customer said about this answer in the widget. */
function CustomerVote({
  feedback,
  customer,
  addToEvalSet,
}: {
  feedback: MessageFeedback;
  customer: string;
  addToEvalSet: ReactNode;
}) {
  const now = useNow();
  const when = formatRelative(feedback.updated_at, now);
  if (feedback.vote === "up") {
    return (
      <p className="max-w-full text-right text-sm text-ink-muted">
        <ThumbsUpIcon aria-hidden="true" className="mr-1.5 inline size-3.5 align-[-2px] text-ink" weight="bold" />
        {customer} said this helped, {when}
      </p>
    );
  }
  return (
    <div className="flex w-full items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm">
      <ThumbsDownIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rust" weight="bold" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium text-ink">{customer} said this did not help</p>
        {feedback.comment ? (
          <p dir="auto" className="break-words whitespace-pre-wrap text-ink">
            {feedback.comment}
          </p>
        ) : null}
        <p className="text-ink-muted">
          In the widget, {when}. It counts in your wrong-answer rate.
        </p>
        {addToEvalSet ? <div className="pt-1 text-ink-muted">{addToEvalSet}</div> : null}
      </div>
    </div>
  );
}

function DeliveryLine({ delivery }: { delivery: EmailDelivery }) {
  const now = useNow();
  if (delivery.status === "sent") {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
        <CheckIcon aria-hidden="true" className="size-3.5 text-ink" weight="bold" />
        Emailed to {delivery.to_hint}
        {delivery.sent_at ? `, ${formatRelative(delivery.sent_at, now)}` : null}
      </p>
    );
  }
  if (delivery.status === "queued") {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-ink-muted" role="status">
        <span className="spinner text-xs" aria-hidden="true" />
        Sending to {delivery.to_hint}
      </p>
    );
  }
  const dead = delivery.status === "dead";
  return (
    <p className={cn("flex max-w-[85%] items-start gap-1.5 text-right text-sm", dead ? "text-rust" : "text-ink-muted")}>
      <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
      <span>
        {dead ? "Not delivered" : `Not sent yet, trying again (attempt ${delivery.attempts})`}
        {delivery.last_error ? `: ${delivery.last_error}` : null}
      </span>
    </p>
  );
}

function FlagDialog({
  target,
  onClose,
  onFlagged,
}: {
  target: InboxMessage | null;
  onClose: () => void;
  onFlagged: (message: InboxMessage) => void;
}) {
  const form = useApiForm();
  const [reason, setReason] = useState("");
  const [last, setLast] = useState(target);
  if (target && target !== last) {
    setLast(target);
    setReason("");
  }
  const shown = target ?? last;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shown) return;
    if (!form.check({ reason: reason.trim().length < 3 && "Say what was wrong, in a few words." })) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/messages/{message_id}/flag", {
            params: { path: { message_id: shown.id } },
            body: { reason: reason.trim() },
          }),
        ),
      (message) => {
        onFlagged(message);
        onClose();
      },
    );
  }

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title="Mark this answer as wrong"
      description="It counts in your wrong-answer rate, so you can see where the agent needs better sources."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-4">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          {shown ? (
            <blockquote className="line-clamp-4 border-l-2 border-line-strong pl-3 text-sm break-words text-ink-muted">
              {shown.content}
            </blockquote>
          ) : null}
          <Field label="What was wrong" error={form.fieldError("reason")}>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Refunds take 14 days, not 30."
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            Mark as wrong
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
