import type { AdminBillingEvent, PlanId, WorkspaceSort, WorkspaceState } from "@docent/api-client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/** Where a workspace stands, in the words the console uses. */
export const stateLabel: Record<WorkspaceState, string> = {
  trial: "Trial",
  trial_ended: "Trial ended",
  paying: "Paying",
  comped: "Comped",
  comp_ended: "Comp ended",
  past_due: "Past due",
  canceled: "Canceled",
  other: "Other",
};

export const stateOptions = Object.entries(stateLabel) as [WorkspaceState, string][];

export const planLabel: Record<PlanId, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

export const planOptions = Object.entries(planLabel) as [PlanId, string][];

export const sortOptions: [WorkspaceSort, string][] = [
  ["newest", "Newest first"],
  ["name", "Name"],
  ["cost", "Highest model cost"],
  ["margin", "Lowest margin"],
];

export function planName(id: string) {
  return planLabel[id as PlanId] ?? id;
}

/**
 * Paying stands out; ended states recede; past due reads as a problem in rust,
 * always with its words, never color alone.
 */
export function StateBadge({ state }: { state: WorkspaceState }) {
  const tone = state === "paying" ? "accent" : state === "trial" || state === "comped" ? "neutral" : "outline";
  return (
    <Badge tone={tone} className={cn(state === "past_due" && "border-rust/50 text-rust")}>
      {stateLabel[state]}
    </Badge>
  );
}

const outcomeLabel: Record<NonNullable<AdminBillingEvent["outcome"]>, string> = {
  applied: "Applied",
  ignored: "Ignored",
  stale: "Out of date",
  unknown_customer: "Unknown customer",
};

/** What applying a Stripe event did. Events from before outcomes were kept have none. */
export function OutcomeBadge({ outcome }: { outcome: AdminBillingEvent["outcome"] }) {
  if (outcome === null) return <span className="text-sm text-ink-subtle">Not recorded</span>;
  return (
    <Badge
      tone={outcome === "applied" ? "neutral" : "outline"}
      className={cn(outcome === "unknown_customer" && "border-rust/50 text-rust")}
    >
      {outcomeLabel[outcome]}
    </Badge>
  );
}
