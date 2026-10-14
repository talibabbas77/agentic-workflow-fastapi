import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentSettingsForm } from "@/components/agent/agent-settings-form";
import { AgentSkeleton } from "@/components/agent/agent-skeleton";
import { PreviewChat } from "@/components/agent/preview-chat";
import { PageHeader } from "@/components/ui/page-header";
import { getAgentSettings, getMe, getTicketTypes } from "@/lib/api/server";

export const metadata: Metadata = { title: "Agent" };

export default function AgentPage() {
  return (
    <Suspense fallback={<AgentSkeleton />}>
      <Agent />
    </Suspense>
  );
}

async function Agent() {
  const [me, settings, ticketTypes] = await Promise.all([getMe(), getAgentSettings(), getTicketTypes()]);
  const role = me.active_tenant?.role;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Agent"
        description="Try the agent the way your customers will, and set how it talks and what it never answers."
      />
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <PreviewChat ticketTypes={ticketTypes} />
        <AgentSettingsForm initial={settings} canEdit={role === "owner" || role === "admin"} />
      </div>
    </div>
  );
}
