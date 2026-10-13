import type { Plan } from "@docent/api-client";
import { cacheLife } from "next/cache";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

/**
 * The plan catalog, the same one billing uses. Cached for hours. When the API
 * cannot be reached it returns null and caches that only for a minute, so the
 * page recovers on its own.
 */
export async function getPlans(): Promise<Plan[] | null> {
  "use cache";
  try {
    const response = await fetch(`${API_INTERNAL_URL}/v1/public/plans`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`plans: ${response.status}`);
    const plans = (await response.json()) as Plan[];
    cacheLife("hours");
    return plans;
  } catch {
    cacheLife("minutes");
    return null;
  }
}

export function formatPrice(plan: Plan) {
  return plan.price_usd_month === 0 ? "Free" : `$${plan.price_usd_month}`;
}
