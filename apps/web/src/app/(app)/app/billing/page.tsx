import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingManager, type CheckoutReturn } from "@/components/billing/billing-manager";
import { BillingSkeleton } from "@/components/billing/billing-skeleton";
import { getBilling } from "@/lib/api/server";
import { getPlans } from "@/lib/plans";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage({ searchParams }: PageProps<"/app/billing">) {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingSection searchParams={searchParams} />
    </Suspense>
  );
}

async function BillingSection({ searchParams }: Pick<PageProps<"/app/billing">, "searchParams">) {
  const [billing, plans, { checkout }] = await Promise.all([getBilling(), getPlans(), searchParams]);
  const returned: CheckoutReturn = checkout === "success" || checkout === "canceled" ? checkout : null;
  return <BillingManager initial={billing} plans={plans} checkout={returned} />;
}
