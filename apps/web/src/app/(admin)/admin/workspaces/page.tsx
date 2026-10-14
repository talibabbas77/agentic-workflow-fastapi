import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspacesSkeleton } from "@/components/admin/console-skeleton";
import { planOptions, sortOptions, stateOptions } from "@/components/admin/labels";
import { oneOf, pageParam, param } from "@/components/admin/query";
import { WorkspacesView, type WorkspaceFilters } from "@/components/admin/workspaces-view";
import { getAdminWorkspaces } from "@/lib/api/server";

export const metadata: Metadata = { title: "Workspaces" };

const plans = planOptions.map(([id]) => id);
const states = stateOptions.map(([state]) => state);
const sorts = sortOptions.map(([sort]) => sort);

export default function AdminWorkspacesPage({ searchParams }: PageProps<"/admin/workspaces">) {
  return (
    <Suspense fallback={<WorkspacesSkeleton />}>
      <Workspaces searchParams={searchParams} />
    </Suspense>
  );
}

async function Workspaces({ searchParams }: Pick<PageProps<"/admin/workspaces">, "searchParams">) {
  const params = await searchParams;
  const filters: WorkspaceFilters = {
    q: param(params, "q"),
    plan: oneOf(param(params, "plan"), plans),
    status: oneOf(param(params, "status"), states),
    sort: oneOf(param(params, "sort"), sorts) ?? "newest",
    page: pageParam(params),
  };
  const data = await getAdminWorkspaces(filters);
  return <WorkspacesView data={data} filters={filters} />;
}
