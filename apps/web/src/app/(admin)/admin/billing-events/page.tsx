import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingEventsView } from "@/components/admin/billing-events-view";
import { ConsoleSkeleton } from "@/components/admin/console-skeleton";
import { pageParam } from "@/components/admin/query";
import { getAdminBillingEvents } from "@/lib/api/server";

export const metadata: Metadata = { title: "Billing events" };

export default function AdminBillingEventsPage({ searchParams }: PageProps<"/admin/billing-events">) {
  return (
    <Suspense fallback={<ConsoleSkeleton label="Loading billing events" tiles={0} rows={8} />}>
      <Events searchParams={searchParams} />
    </Suspense>
  );
}

async function Events({ searchParams }: Pick<PageProps<"/admin/billing-events">, "searchParams">) {
  const page = pageParam(await searchParams);
  return <BillingEventsView data={await getAdminBillingEvents({ page })} />;
}
