"use client";

import type { InboxItem } from "@docent/api-client";
import { EnvelopeSimpleIcon, UserCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { PriorityBadge, reasonLabel, StatusBadge, UnreadDot } from "./inbox-meta";

/** Who the handoff is from: the signed-in name, the email they left, or neither. */
export function customerLabel(item: InboxItem) {
  return item.customer_name ?? item.contact_email ?? "Anonymous visitor";
}

export function InboxList({
  items,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: InboxItem[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const now = useNow();
  return (
    <div className="flex flex-col gap-4">
      <Card aria-label="Handoffs" className="overflow-hidden">
        <ul>
          {items.map((item) => (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <Link
                href={`/app/inbox/${item.id}`}
                className={cn(
                  "group flex gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-2/60 focus-visible:-outline-offset-2 sm:px-5",
                  item.unread && "bg-paper/40",
                )}
              >
                <span className="mt-1.5">
                  <UnreadDot unread={item.unread} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <p
                      dir="auto"
                      className={cn(
                        "line-clamp-2 min-w-0 break-words text-ink group-hover:underline group-hover:underline-offset-[3px]",
                        item.unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {item.issue}
                    </p>
                    <time
                      dateTime={item.updated_at}
                      className="mt-0.5 shrink-0 text-sm whitespace-nowrap text-ink-muted tabular-nums"
                    >
                      {formatRelative(item.created_at, now)}
                    </time>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
                    <StatusBadge status={item.status} />
                    <PriorityBadge priority={item.priority} />
                    {item.ticket_type ? <Badge tone="neutral">{item.ticket_type.name}</Badge> : null}
                    {item.channel === "preview" ? <Badge tone="outline">Preview</Badge> : null}
                    <span>{reasonLabel[item.reason]}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      {item.customer_name ? (
                        <UserCircleIcon aria-hidden="true" className="size-4 shrink-0" />
                      ) : (
                        <EnvelopeSimpleIcon aria-hidden="true" className="size-4 shrink-0" />
                      )}
                      <span className="truncate">{customerLabel(item)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 sm:ml-auto">
                      {item.assignee ? (
                        <>
                          <Avatar name={item.assignee.name} seed={item.assignee.id} size="sm" />
                          <span className="text-ink">{item.assignee.name}</span>
                        </>
                      ) : (
                        <span>Nobody assigned</span>
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      {hasMore ? (
        <Button variant="secondary" className="self-center" loading={loadingMore} onClick={onLoadMore}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}
