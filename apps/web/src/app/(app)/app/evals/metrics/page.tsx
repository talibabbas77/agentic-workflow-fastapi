import type { Metadata } from "next";
import { Suspense } from "react";
import { EvalsDetailSkeleton } from "@/components/evals/evals-skeleton";
import { MetricsDashboard } from "@/components/evals/metrics-dashboard";
import { PERIODS } from "@/components/evals/periods";
import { getProductionMetrics } from "@/lib/api/server";

export const metadata: Metadata = { title: "Production metrics" };

export default function MetricsPage({ searchParams }: PageProps<"/app/evals/metrics">) {
  return (
    <Suspense fallback={<EvalsDetailSkeleton label="Loading metrics" />}>
      <Metrics searchParams={searchParams} />
    </Suspense>
  );
}

async function Metrics({ searchParams }: Pick<PageProps<"/app/evals/metrics">, "searchParams">) {
  const { days } = await searchParams;
  const asked = Number(days);
  const period = PERIODS.find((p) => p === asked) ?? 30;
  return <MetricsDashboard metrics={await getProductionMetrics(period)} />;
}
