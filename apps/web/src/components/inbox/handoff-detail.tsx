"use client";

import type { Assignee, InboxDetail, InboxMessage, InboxUpdate, TicketType } from "@docent/api-client";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { usePoll } from "@/lib/use-poll";
import { Activity, Customer, Handling, Notes, Summary, TicketDetails } from "./handoff-panel";
import { customerLabel } from "./inbox-list";
import { PriorityBadge, reasonLabel, StatusBadge } from "./inbox-meta";
import { ReplyComposer } from "./reply-composer";
import { Transcript } from "./transcript";

/**
 * One handoff: the conversation and a reply box on the left, everything the
 * team needs to work it on the right. On a phone the handling and summary come
 * first, then the conversation, then the rest.
 */
export function HandoffDetail({
  initial,
  ticketTypes,
  assignees,
}: {
  initial: InboxDetail;
  ticketTypes: TicketType[];
  assignees: Assignee[];
}) {
  const toast = useToast();
  const now = useNow();
  const [detail, setDetail] = useState(initial);
  const [saving, setSaving] = useState(false);
  const id = detail.item.id;

  const markRead = useCallback(() => {
    void request(api.POST("/v1/inbox/{escalation_id}/read", { params: { path: { escalation_id: id } } }));
  }, [id]);

  useEffect(markRead, [markRead]);

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/inbox/{escalation_id}", { params: { path: { escalation_id: id } } }));
    if (!result.ok) return;
    setDetail(result.data);
    if (result.data.item.unread) markRead(); // you are looking at it
  }, [id, markRead]);

  // Quick while a summary or an email is on its way; slow otherwise, to catch new messages.
  const waiting =
    !detail.item.summary_ready || detail.deliveries.some((d) => d.status === "queued" || d.status === "retrying");
  usePoll(true, refresh, waiting ? 2500 : 10000);

  async function update(body: InboxUpdate) {
    setSaving(true);
    const result = await request(
      api.PATCH("/v1/inbox/{escalation_id}", { params: { path: { escalation_id: id } }, body }),
    );
    setSaving(false);
    if (result.ok) {
      setDetail(result.data);
      toast({ tone: "success", title: "Saved" });
    } else {
      toast({ tone: "error", title: "Could not save that", description: result.error.message });
    }
  }

  function replaceMessage(message: InboxMessage) {
    setDetail((d) => ({ ...d, messages: d.messages.map((m) => (m.id === message.id ? message : m)) }));
  }

  const item = detail.item;
  const customer = customerLabel(item);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/app/inbox"
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          Inbox
        </Link>
        <div className="flex flex-col gap-3">
          <h1 dir="auto" className="text-2xl break-words text-ink sm:text-3xl">
            {item.issue}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted">
            <StatusBadge status={item.status} />
            <PriorityBadge priority={item.priority} />
            {item.ticket_type ? <Badge>{item.ticket_type.name}</Badge> : null}
            {item.channel === "preview" ? <Badge tone="outline">Preview</Badge> : null}
            <span>{reasonLabel[item.reason]}</span>
            <span>From {customer}</span>
            <span className="tabular-nums">Handed off {formatRelative(item.created_at, now)}</span>
            {detail.routed_by_rule ? <span>Routed by {detail.routed_by_rule}</span> : null}
          </p>
        </div>
      </div>

      <div className="grid gap-6 [grid-template-areas:'top'_'main'_'bottom'] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'main_top'_'main_bottom']">
        <div className="flex min-w-0 flex-col gap-6 [grid-area:main]">
          <Card aria-labelledby="conversation-heading" className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
              <CardTitle id="conversation-heading" as="h2" className="text-base font-semibold">
                Conversation
              </CardTitle>
              <span className="text-sm text-ink-muted tabular-nums">
                {detail.messages.length} {detail.messages.length === 1 ? "message" : "messages"}
              </span>
            </div>
            <div className="px-5 py-5 sm:px-6">
              <Transcript
                messages={detail.messages}
                customer={customer}
                reason={item.reason}
                onChange={replaceMessage}
              />
            </div>
            <ReplyComposer
              detail={detail}
              onSent={(message, next) => {
                setDetail((d) => ({ ...d, item: next, messages: [...d.messages, message] }));
                toast({ tone: "success", title: "Reply sent", description: `To ${next.contact_email}` });
                void refresh();
              }}
            />
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-6 [grid-area:top]">
          <Handling detail={detail} assignees={assignees} saving={saving} onUpdate={update} />
          <Summary detail={detail} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 [grid-area:bottom]">
          <Customer detail={detail} />
          <TicketDetails
            key={`${item.ticket_type?.id ?? "none"}:${JSON.stringify(detail.fields)}`}
            detail={detail}
            ticketTypes={ticketTypes}
            onUpdate={update}
            onSaved={(next) => {
              setDetail(next);
              toast({ tone: "success", title: "Details saved" });
            }}
          />
          <Notes
            detail={detail}
            onAdded={(note) => setDetail((d) => ({ ...d, notes: [...d.notes, note] }))}
            onDeleted={(note) => setDetail((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== note.id) }))}
          />
          <Activity detail={detail} />
        </div>
      </div>
    </div>
  );
}
