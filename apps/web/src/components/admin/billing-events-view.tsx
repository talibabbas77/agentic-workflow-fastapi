"use client";

import type { AdminBillingEvent, AdminBillingEvents } from "@docent/api-client";
import { ReceiptIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/lib/format";
import { Pager } from "./bits";
import { OutcomeBadge } from "./labels";
import { queryHref } from "./query";

export function BillingEventsView({ data }: { data: AdminBillingEvents }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing events"
        description="Stripe webhooks as they arrived, newest first, with the workspace each one was for and what applying it did."
      />
      {data.items.length === 0 ? (
        <EmptyState
          illustration={<ReceiptIcon aria-hidden="true" className="size-10 text-ink-subtle" weight="light" />}
          title={data.page > 1 ? "No events on this page" : "No Stripe events yet"}
        >
          <p>Stripe sends them to /v1/webhooks/stripe once payments are set up and a workspace checks out.</p>
        </EmptyState>
      ) : (
        <Card aria-label="Billing events" className="min-w-0">
          <EventsTable events={data.items} />
          <ul className="lg:hidden">
            {data.items.map((event) => (
              <li key={event.id} className="flex flex-col gap-2 border-b border-line px-5 py-4 last:border-b-0 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <EventName event={event} />
                  <OutcomeBadge outcome={event.outcome} />
                </div>
                <Workspace event={event} />
                <p className="text-sm text-ink-muted">Received {formatDateTime(event.received_at)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Pager
        page={data.page}
        perPage={data.per_page}
        total={data.total}
        noun="events"
        href={(page) => queryHref("/admin/billing-events", { page })}
      />
    </div>
  );
}

function EventsTable({ events }: { events: AdminBillingEvent[] }) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full text-left text-base">
        <thead>
          <tr className="border-b border-line text-sm text-ink-muted">
            <th scope="col" className="px-6 py-2.5 font-medium">
              Event
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Workspace
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Outcome
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Sent by Stripe
            </th>
            <th scope="col" className="px-6 py-2.5 font-medium">
              Received
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b border-line last:border-b-0">
              <td className="max-w-96 px-6 py-3">
                <EventName event={event} />
              </td>
              <td className="px-3 py-3">
                <Workspace event={event} />
              </td>
              <td className="px-3 py-3">
                <OutcomeBadge outcome={event.outcome} />
              </td>
              <td className="px-3 py-3 text-sm whitespace-nowrap text-ink-muted">{formatDateTime(event.created_at)}</td>
              <td className="px-6 py-3 text-sm whitespace-nowrap text-ink-muted">{formatDateTime(event.received_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventName({ event }: { event: AdminBillingEvent }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-mono text-sm text-ink">{event.type}</span>
      <span className="truncate font-mono text-xs text-ink-muted">{event.id}</span>
    </div>
  );
}

function Workspace({ event }: { event: AdminBillingEvent }) {
  if (!event.tenant_id || !event.workspace_name) {
    return <span className="text-sm text-ink-muted">No workspace matched</span>;
  }
  return (
    <Link
      prefetch={false}
      href={`/admin/workspaces/${event.tenant_id}`}
      className="rounded-sm text-ink underline-offset-[3px] hover:underline"
    >
      {event.workspace_name}
    </Link>
  );
}
