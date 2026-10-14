import type { Plan } from "@docent/api-client";

/*
 * Plain arithmetic over the plan catalog. No prices or caps live here: every
 * number comes from the plans API. Safe to import from client components.
 */

const countFormat = new Intl.NumberFormat("en-US");

export function count(n: number) {
  return countFormat.format(n);
}

export function priceLabel(plan: Pick<Plan, "price_usd_month">) {
  return plan.price_usd_month === 0 ? "Free" : `$${count(plan.price_usd_month)}`;
}

/** "$29" or "$14.50", for a top-up pack's price in cents. */
export function packPrice(cents: number) {
  return cents % 100 === 0 ? `$${count(cents / 100)}` : `$${(cents / 100).toFixed(2)}`;
}

export function periodLabel(plan: Pick<Plan, "trial_days">) {
  return plan.trial_days ? `for ${plan.trial_days} days` : "per month";
}

/** Plans a customer can stay on: everything except the time-limited trial. */
export function monthlyPlans(plans: Plan[]) {
  return plans
    .filter((plan) => !plan.trial_days && plan.price_usd_month > 0)
    .sort((a, b) => a.replies_per_month - b.replies_per_month);
}

/**
 * Price per reply if every reply in the plan is used, in US cents, rounded to
 * one decimal. "About 2 cents" rather than "About 2.0 cents".
 */
export function centsPerReply(plan: Pick<Plan, "price_usd_month" | "replies_per_month">) {
  if (plan.price_usd_month <= 0 || plan.replies_per_month <= 0) return null;
  // Tenths of a cent, rounded half up in whole numbers so 1.495 becomes 1.5, not 1.4.
  const tenths = Math.floor((plan.price_usd_month * 1000 + plan.replies_per_month / 2) / plan.replies_per_month);
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

/** The estimate the pricing pages start from, before anyone moves the slider. */
export const DEFAULT_ESTIMATE = 3000;

/** The smallest monthly plan whose cap covers the estimate, or null if none does. */
export function recommendPlan(plans: Plan[], replies: number) {
  return monthlyPlans(plans).find((plan) => plan.replies_per_month >= replies) ?? null;
}
