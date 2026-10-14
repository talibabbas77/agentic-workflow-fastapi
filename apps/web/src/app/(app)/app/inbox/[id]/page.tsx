import type { Metadata } from "next";
import { Suspense } from "react";
import { HandoffDetail } from "@/components/inbox/handoff-detail";
import { HandoffSkeleton } from "@/components/inbox/inbox-skeleton";
import { getAssignees, getHandoff, getMe, getTicketTypes } from "@/lib/api/server";

export const metadata: Metadata = { title: "Handoff" };

export default function HandoffPage({ params }: PageProps<"/app/inbox/[id]">) {
  return (
    <Suspense fallback={<HandoffSkeleton />}>
      <Handoff params={params} />
    </Suspense>
  );
}

async function Handoff({ params }: Pick<PageProps<"/app/inbox/[id]">, "params">) {
  const { id } = await params;
  const [me, detail, ticketTypes, assignees] = await Promise.all([
    getMe(),
    getHandoff(id),
    getTicketTypes(),
    getAssignees(),
  ]);
  const role = me.active_tenant?.role;
  return (
    <HandoffDetail
      key={detail.item.id}
      initial={detail}
      ticketTypes={ticketTypes}
      assignees={assignees}
      canManageEvals={role === "owner" || role === "admin"}
      emailVerified={me.user.email_verified}
    />
  );
}
