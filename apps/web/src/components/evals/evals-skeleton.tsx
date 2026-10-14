import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** A list page of Evals while it loads: a toolbar, then rows. */
export function EvalsListSkeleton({ label = "Loading", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <Loading label={label} className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-5 w-full max-w-sm" />
        <Skeleton className="h-10 w-32 shrink-0 rounded-md" />
      </div>
      <div className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex flex-col gap-2.5 border-b border-line px-5 py-4 last:border-b-0">
            <div className="flex items-center justify-between gap-6">
              <Skeleton className="h-4 w-full max-w-xs" />
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** A detail page of Evals while it loads: a title, a row of numbers, then a list. */
export function EvalsDetailSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <Loading label={label} className="flex flex-col gap-6">
      <Skeleton className="h-4 w-16" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-full max-w-md" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 bg-surface px-5 py-4">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </Loading>
  );
}
