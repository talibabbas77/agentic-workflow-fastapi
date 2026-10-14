import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketTypesManager } from "@/components/handoffs/ticket-types-manager";
import { ListPageSkeleton } from "@/components/shell/page-skeleton";
import { getMe, getTicketTypes } from "@/lib/api/server";

export const metadata: Metadata = { title: "Ticket types" };

export default function HandoffsPage() {
  return (
    <Suspense fallback={<ListPageSkeleton label="Loading ticket types" />}>
      <Handoffs />
    </Suspense>
  );
}

async function Handoffs() {
  const [me, ticketTypes] = await Promise.all([getMe(), getTicketTypes()]);
  const role = me.active_tenant?.role;
  return <TicketTypesManager initial={ticketTypes} canManage={role === "owner" || role === "admin"} />;
}
