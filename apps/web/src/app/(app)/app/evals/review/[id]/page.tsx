import type { Metadata } from "next";
import { Suspense } from "react";
import { EvalsDetailSkeleton } from "@/components/evals/evals-skeleton";
import { ReviewItemView } from "@/components/evals/review-item";
import { getMe, getReviewItem } from "@/lib/api/server";

export const metadata: Metadata = { title: "Review a conversation" };

export default function ReviewItemPage({ params }: PageProps<"/app/evals/review/[id]">) {
  return (
    <Suspense fallback={<EvalsDetailSkeleton label="Loading the conversation" />}>
      <ReviewItem params={params} />
    </Suspense>
  );
}

async function ReviewItem({ params }: Pick<PageProps<"/app/evals/review/[id]">, "params">) {
  const { id } = await params;
  const [me, detail] = await Promise.all([getMe(), getReviewItem(id)]);
  const role = me.active_tenant?.role;
  return (
    <ReviewItemView
      key={detail.item.id}
      initial={detail}
      canManageEvals={role === "owner" || role === "admin"}
    />
  );
}
