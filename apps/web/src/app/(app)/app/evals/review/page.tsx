import type { Metadata } from "next";
import { Suspense } from "react";
import { EvalsListSkeleton } from "@/components/evals/evals-skeleton";
import { ReviewQueue } from "@/components/evals/review-queue";
import { getReviewQueue } from "@/lib/api/server";

export const metadata: Metadata = { title: "Weekly review" };

export default function ReviewPage({ searchParams }: PageProps<"/app/evals/review">) {
  return (
    <Suspense fallback={<EvalsListSkeleton label="Loading the review queue" rows={6} />}>
      <Review searchParams={searchParams} />
    </Suspense>
  );
}

async function Review({ searchParams }: Pick<PageProps<"/app/evals/review">, "searchParams">) {
  const { week } = await searchParams;
  const wanted = typeof week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : undefined;
  return <ReviewQueue queue={await getReviewQueue(wanted)} />;
}
