import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsoleOverview } from "@/components/admin/console-overview";
import { ConsoleSkeleton } from "@/components/admin/console-skeleton";
import { getAdminOverview } from "@/lib/api/server";

export const metadata: Metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton label="Loading the overview" />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  return <ConsoleOverview data={await getAdminOverview()} />;
}
