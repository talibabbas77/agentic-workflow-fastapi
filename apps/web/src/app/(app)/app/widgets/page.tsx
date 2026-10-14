import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPageSkeleton } from "@/components/shell/page-skeleton";
import { WidgetsManager } from "@/components/widgets/widgets-manager";
import { getMe, getWidgets } from "@/lib/api/server";

export const metadata: Metadata = { title: "Widgets" };

export default function WidgetsPage() {
  return (
    <Suspense fallback={<ListPageSkeleton label="Loading widgets" rows={2} />}>
      <Widgets />
    </Suspense>
  );
}

async function Widgets() {
  const [me, widgets] = await Promise.all([getMe(), getWidgets()]);
  const role = me.active_tenant?.role;
  return <WidgetsManager widgets={widgets} canManage={role === "owner" || role === "admin"} />;
}
