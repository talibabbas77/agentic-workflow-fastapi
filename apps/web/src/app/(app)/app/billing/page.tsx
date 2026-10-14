import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingManager, type CheckoutReturn, type TopupReturn } from "@/components/billing/billing-manager";
import { BillingSkeleton } from "@/components/billing/billing-skeleton";
import { getBilling, getPlanCatalog } from "@/lib/api/server";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage({ searchParams }: PageProps<"/app/billing">) {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingSection searchParams={searchParams} />
    </Suspense>
  );
}

async function BillingSection({ searchParams }: Pick<PageProps<"/app/billing">, "searchParams">) {
  const [billing, plans, { checkout, topup }] = await Promise.all([getBilling(), getPlanCatalog(), searchParams]);
  const returned: CheckoutReturn = checkout === "success" || checkout === "canceled" ? checkout : null;
  const topped: TopupReturn = topup === "success" || topup === "canceled" ? topup : null;
  return <BillingManager initial={billing} plans={plans} checkout={returned} topup={topped} />;
}
