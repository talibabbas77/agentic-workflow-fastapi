import type { Billing, Plan } from "@docent/api-client";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const centsFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** "October", for the usage month that starts on this date. */
export function monthName(periodStart: string) {
  return monthFormat.format(new Date(periodStart));
}

/** "2.9", the plan's price per reply in cents. Every top-up pack costs the same per reply. */
export function centsPerReply(plan: Plan) {
  return centsFormat.format((plan.price_usd_month * 100) / plan.replies_per_month);
}

/** How much of this month's replies, top-ups included, is used: 0.85 for 85 percent. */
export function repliesShare(billing: Billing) {
  const { used, limit } = billing.usage.replies;
  return limit > 0 ? used / limit : 0;
}
