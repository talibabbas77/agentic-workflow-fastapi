import type { Metadata } from "next";
import { Suspense } from "react";
import { AutomationManager } from "@/components/automation/automation-manager";
import { AutomationSkeleton } from "@/components/automation/automation-skeleton";
import {
  getAssignees,
  getInboxSettings,
  getMe,
  getNotificationPrefs,
  getRoutingRules,
  getSlackChannels,
  getTicketTypes,
  getWebhooks,
} from "@/lib/api/server";

export const metadata: Metadata = { title: "Automation" };

export default function AutomationPage() {
  return (
    <Suspense fallback={<AutomationSkeleton />}>
      <Automation />
    </Suspense>
  );
}

async function Automation() {
  const [me, rules, channels, webhooks, ticketTypes, assignees, settings, prefs] = await Promise.all([
    getMe(),
    getRoutingRules(),
    getSlackChannels(),
    getWebhooks(),
    getTicketTypes(),
    getAssignees(),
    getInboxSettings(),
    getNotificationPrefs(),
  ]);
  const role = me.active_tenant?.role;
  return (
    <AutomationManager
      initial={{ rules, channels, webhooks, ticketTypes, assignees, settings, prefs, meEmail: me.user.email }}
      canManage={role === "owner" || role === "admin"}
    />
  );
}
