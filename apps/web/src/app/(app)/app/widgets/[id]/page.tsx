import type { Metadata } from "next";
import { Suspense } from "react";
import { WidgetDetail } from "@/components/widgets/widget-detail";
import { WidgetSkeleton } from "@/components/widgets/widget-skeleton";
import { getMe, getWidget } from "@/lib/api/server";

export const metadata: Metadata = { title: "Widget" };

export default function WidgetPage({ params }: PageProps<"/app/widgets/[id]">) {
  return (
    <Suspense fallback={<WidgetSkeleton />}>
      <WidgetSection params={params} />
    </Suspense>
  );
}

async function WidgetSection({ params }: Pick<PageProps<"/app/widgets/[id]">, "params">) {
  const { id } = await params;
  const [me, widget] = await Promise.all([getMe(), getWidget(id)]);
  const role = me.active_tenant?.role;
  return <WidgetDetail initial={widget} canManage={role === "owner" || role === "admin"} />;
}
