import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsoleSkeleton } from "@/components/admin/console-skeleton";
import { PeopleView } from "@/components/admin/people-view";
import { pageParam, param } from "@/components/admin/query";
import { getAdminPeople } from "@/lib/api/server";

export const metadata: Metadata = { title: "People" };

export default function AdminPeoplePage({ searchParams }: PageProps<"/admin/people">) {
  return (
    <Suspense fallback={<ConsoleSkeleton label="Loading people" tiles={0} rows={8} />}>
      <People searchParams={searchParams} />
    </Suspense>
  );
}

async function People({ searchParams }: Pick<PageProps<"/admin/people">, "searchParams">) {
  const params = await searchParams;
  const q = param(params, "q");
  const page = pageParam(params);
  const data = await getAdminPeople({ q, page });
  return <PeopleView data={data} q={q} />;
}
