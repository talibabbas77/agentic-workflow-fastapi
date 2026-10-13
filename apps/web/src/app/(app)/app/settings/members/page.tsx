import { LockSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { Suspense } from "react";
import { MembersManager } from "@/components/app/members-manager";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getMembers } from "@/lib/api/data";
import { getMe } from "@/lib/api/server";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <Suspense fallback={<MembersSkeleton />}>
      <MembersSection />
    </Suspense>
  );
}

async function MembersSection() {
  const [me, result] = await Promise.all([getMe(), getMembers()]);
  if (!result.ok) {
    if (result.status === 403) {
      return (
        <EmptyState
          illustration={
            <span className="inline-flex size-12 items-center justify-center rounded-md border border-line-strong text-ink-muted">
              <LockSimpleIcon aria-hidden="true" className="size-6" weight="light" />
            </span>
          }
          title="Only owners and admins can manage members"
        >
          <p>
            Ask an owner or admin of {me.active_tenant?.name ?? "this workspace"} to invite people or change
            roles.
          </p>
        </EmptyState>
      );
    }
    throw new Error(result.error.message);
  }
  return <MembersManager data={result.data} me={me} />;
}

function MembersSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading members">
      <Skeleton className="h-72 w-full rounded-md" />
      <Skeleton className="h-36 w-full rounded-md" />
    </div>
  );
}
