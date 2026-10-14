import { getPlans } from "@/lib/plans";
import { CONTACT_EMAIL } from "@/lib/site";
import { DEFAULT_ESTIMATE, recommendPlan } from "./plan-math";
import { CapExplainer, PlanCards, PlansUnavailable, ReplyDefinition } from "./plans";
import { ReplyEstimator } from "./reply-estimator";

/** Estimator, plan cards, what a reply is, and the cap: the pricing block on the home and pricing pages. */
export async function PricingBlock() {
  const plans = await getPlans();
  if (!plans) return <PlansUnavailable />;
  const fit = recommendPlan(plans, DEFAULT_ESTIMATE);
  return (
    <div className="flex flex-col gap-10">
      <ReplyEstimator plans={plans} initial={DEFAULT_ESTIMATE} contactEmail={CONTACT_EMAIL} />
      <PlanCards plans={plans} fit={fit?.id ?? null} />
      <div className="flex flex-col gap-4">
        <ReplyDefinition />
        <CapExplainer />
      </div>
    </div>
  );
}
