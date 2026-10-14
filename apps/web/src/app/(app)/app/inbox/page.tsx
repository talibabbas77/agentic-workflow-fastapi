import type { Metadata } from "next";
import { Suspense } from "react";
import { boardQuery, listQuery, readFilters, readView } from "@/components/inbox/filters";
import { InboxManager } from "@/components/inbox/inbox-manager";
import { InboxSkeleton } from "@/components/inbox/inbox-skeleton";
import { getAssignees, getInbox, getInboxBoard, getTicketTypes } from "@/lib/api/server";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <Inbox searchParams={searchParams} />
    </Suspense>
  );
}

async function Inbox({ searchParams }: Pick<PageProps<"/app/inbox">, "searchParams">) {
  const params = await searchParams;
  const view = readView(params);
  const filters = readFilters(params);
  const [page, board, ticketTypes, assignees] = await Promise.all([
    view === "list" ? getInbox(listQuery(filters)) : null,
    view === "board" ? getInboxBoard(boardQuery(filters)) : null,
    getTicketTypes(),
    getAssignees(),
  ]);
  return (
    <InboxManager
      initialView={view}
      initialFilters={filters}
      initialPage={page}
      initialBoard={board}
      ticketTypes={ticketTypes}
      assignees={assignees}
    />
  );
}
