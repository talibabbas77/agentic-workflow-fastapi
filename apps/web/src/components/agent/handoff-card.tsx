"use client";

import type { Escalation, EscalationSummary, TicketType } from "@docent/api-client";
import { HeadsetIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** Why the agent handed off, in plain words. Codes come from the agent loop. */
const reasons: Record<string, { title: string; detail: string }> = {
  no_source: {
    title: "No supporting source",
    detail: "Nothing in your sources was close enough to answer from, so the agent did not try.",
  },
  user_requested: { title: "Asked for a person", detail: "The customer asked to talk to someone on your team." },
  restricted_topic: {
    title: "Restricted topic",
    detail: "The message mentioned a topic the agent always passes to your team.",
  },
  low_confidence: { title: "Low confidence", detail: "The agent was not sure enough of its answer to send it." },
  repeated_failure: { title: "Could not help", detail: "The agent could not give a useful answer after several tries." },
  cap_reached: {
    title: "Monthly replies used up",
    detail: "The plan's AI replies for this month are used up, so your team takes new questions.",
  },
};

function handoffReason(code: string | null | undefined) {
  return (code && reasons[code]) || { title: "Handed off", detail: "" };
}

const sentiment: Record<EscalationSummary["sentiment"], string> = {
  calm: "Calm",
  frustrated: "Frustrated",
  angry: "Angry",
  unknown: "Not clear",
};

const rowClasses = "grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-y-3";

/**
 * What the team receives: the reason right away, then the ticket type, its
 * filled fields, and the summary once the background job has written them.
 */
export function HandoffCard({
  reason: code,
  escalation,
  ticketTypes,
  late,
  onCheckAgain,
}: {
  reason: string | null;
  /** Null for the moment between the reply and loading the handoff. */
  escalation: Escalation | null;
  ticketTypes: TicketType[];
  /** The summary has not arrived in the usual time, so polling stopped. */
  late: boolean;
  onCheckAgain: () => void;
}) {
  const reason = handoffReason(escalation?.reason ?? code);
  const summary = escalation?.summary;
  const type = ticketTypes.find((t) => t.name === escalation?.ticket_type);
  const fieldLabel = (key: string) => type?.fields.find((f) => f.key === key)?.label ?? key;

  return (
    <section aria-label="Handoff to your team" className="w-full overflow-hidden rounded-md border border-line bg-paper">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-rust-soft text-rust"
        >
          <HeadsetIcon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium text-ink">Handed to your team</p>
          <p className="text-sm text-ink-muted">
            <span className="font-medium text-ink">{reason.title}.</span> {reason.detail}
          </p>
        </div>
      </div>

      {escalation && summary ? (
        <dl className="fade-in flex flex-col gap-3 px-4 py-4 text-base">
          <Row term="Ticket type">
            {escalation.ticket_type ?? <span className="text-ink-muted">No type matched</span>}
          </Row>
          {Object.entries(escalation.fields).map(([key, value]) => (
            <Row key={key} term={fieldLabel(key)}>
              {value}
            </Row>
          ))}
          <Row term="Issue">{summary.issue}</Row>
          <Row term="Already tried">{summary.tried}</Row>
          <Row term="About the customer">{summary.user_context}</Row>
          <Row term="Mood">{sentiment[summary.sentiment]}</Row>
          <Row term="Next step">{summary.suggested_next_step}</Row>
        </dl>
      ) : (
        <Loading label="Writing the handoff summary" className="flex flex-col gap-4 px-4 py-4">
          {late ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-muted">The summary is taking longer than usual.</p>
              <Button variant="secondary" size="sm" onClick={onCheckAgain}>
                Check again
              </Button>
            </div>
          ) : (
            <p aria-hidden="true" className="flex items-center gap-2 text-sm text-ink-muted">
              <span className="spinner text-xs" />
              Choosing a ticket type and writing a summary for your team
            </p>
          )}
          <div className="flex flex-col gap-3">
            {["w-24", "w-64", "w-72", "w-56"].map((width, index) => (
              <div key={index} className={rowClasses}>
                <Skeleton className="h-4 w-20" />
                <Skeleton className={`h-4 max-w-full ${width}`} />
              </div>
            ))}
          </div>
        </Loading>
      )}
    </section>
  );
}

/** An earlier handoff in the same conversation: the latest one carries the full card. */
export function HandoffNote({ reason }: { reason: string | null }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-ink-muted">
      <HeadsetIcon aria-hidden="true" className="size-4 text-rust" />
      Handed to your team: {handoffReason(reason).title.toLowerCase()}
    </p>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={`${rowClasses} items-baseline`}>
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd dir="auto" className="break-words text-ink">
        {children}
      </dd>
    </div>
  );
}
