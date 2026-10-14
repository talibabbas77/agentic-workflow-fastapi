import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches the memory page: header, the map with its guide, totals, cited sections, and the tabs. */
export function MemorySkeleton() {
  return (
    <Loading label="Loading memory" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-md border border-line lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Skeleton className="h-[26rem] w-full rounded-none sm:h-[30rem]" />
        <Skeleton className="hidden h-[30rem] w-full rounded-none lg:block" />
      </div>
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-64 w-full rounded-md" />
      <div className="flex flex-col gap-6">
        <div className="flex gap-6 border-b border-line pb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="hidden h-5 w-36 sm:block" />
        </div>
        <div className="flex flex-col gap-px overflow-hidden rounded-md border border-line">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-none" />
          ))}
        </div>
      </div>
    </Loading>
  );
}
