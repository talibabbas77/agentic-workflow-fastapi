import type { Billing, PaidPlanId, Plan } from "@docent/api-client";
import { formatCount, formatDate, plural } from "@/lib/format";

/** Stripe statuses with a running subscription. Plan changes then go through the portal, not checkout. */
const LIVE = new Set(["trialing", "active", "past_due"]);

export type PaidPlan = Plan & { id: PaidPlanId };

export const isPaid = (plan: Plan): plan is PaidPlan => plan.price_usd_month > 0;

/** "$99", for a plan's monthly price. */
export const monthlyPrice = (plan: Plan) => `$${formatCount(plan.price_usd_month)}`;

export function isSubscribed(billing: Billing) {
  return billing.provider === "stripe" && LIVE.has(billing.status);
}

export type PlanState = { label: string; detail: string | null; warn: boolean };

const DAY_MS = 86_400_000;

/**
 * The plan's status in plain words. `now` is null until the browser clock is
 * known, so the first render shows the end date without a day count.
 */
export function planState(billing: Billing, now: number | null): PlanState {
  const { status, active } = billing;
  const date = (iso: string | null) => (iso ? formatDate(iso) : null);

  if (status === "trialing") {
    const ends = date(billing.trial_ends_at);
    if (!active) return { label: "Trial ended", detail: ends ? `The trial ended on ${ends}.` : null, warn: true };
    if (!billing.trial_ends_at || now === null) {
      return { label: "Trial", detail: ends ? `The trial ends on ${ends}.` : null, warn: false };
    }
    const days = Math.max(0, Math.ceil((Date.parse(billing.trial_ends_at) - now) / DAY_MS));
    return { label: `Trial, ${days} ${plural(days, "day")} left`, detail: `The trial ends on ${ends}.`, warn: false };
  }
  if (status === "active" && billing.comped_until) {
    // A paid plan Docent gave at no charge. It ends by itself; nothing renews.
    const ends = date(billing.comped_until);
    if (!active) return { label: "Free plan ended", detail: `It ended on ${ends}.`, warn: true };
    return {
      label: `Free until ${ends}`,
      detail: "Docent gave this workspace the plan at no charge. Choose a plan to keep answers on after that.",
      warn: false,
    };
  }
  if (status === "active") {
    const ends = date(billing.cancel_at ?? billing.current_period_end);
    if (billing.cancel_at_period_end || billing.cancel_at) {
      return {
        label: ends ? `Active until ${ends}` : "Canceled",
        detail: "The plan is canceled and does not renew.",
        warn: false,
      };
    }
    const renews = date(billing.current_period_end);
    return { label: renews ? `Active, renews on ${renews}` : "Active", detail: null, warn: false };
  }
  if (status === "past_due" || status === "unpaid") {
    const grace = date(billing.grace_ends_at);
    if (active && grace) {
      const fix = !billing.can_manage
        ? " Ask an owner to update the card."
        : billing.provider === "stripe"
          ? " Update the card in Manage billing."
          : "";
      return { label: "Payment failed", detail: `The agent keeps answering until ${grace}.${fix}`, warn: true };
    }
    return { label: "Payment failed", detail: grace ? `The grace period ended on ${grace}.` : null, warn: true };
  }
  if (status === "canceled") return { label: "Canceled", detail: null, warn: true };
  if (status === "incomplete" || status === "incomplete_expired") {
    return { label: "Checkout not finished", detail: "The first payment did not go through.", warn: true };
  }
  if (status === "paused") return { label: "Paused", detail: null, warn: true };
  return { label: active ? "Active" : "Not active", detail: null, warn: !active };
}

/** Why the agent is handing everything off, for the escalate-only banner. */
export function inactiveReason(billing: Billing) {
  switch (billing.status) {
    case "trialing":
      return "The trial has ended";
    case "active":
      return billing.comped_until ? "The free plan from Docent has ended" : "The plan is not active";
    case "canceled":
      return "The plan was canceled";
    case "past_due":
    case "unpaid":
      return "A payment failed and the grace period is over";
    default:
      return "The plan is not active";
  }
}
