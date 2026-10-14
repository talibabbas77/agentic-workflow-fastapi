import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches the agent page: header, the preview, and the settings beside it on wide screens. */
export function AgentSkeleton() {
  return (
    <Loading label="Loading the agent" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-[44rem] w-full rounded-md" />
        <Skeleton className="h-[30rem] w-full rounded-md" />
      </div>
    </Loading>
  );
}
