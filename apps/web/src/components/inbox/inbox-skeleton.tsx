import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** The inbox while it loads: header, filters, and a few rows. */
export function InboxSkeleton() {
  return (
    <Loading label="Loading the inbox" className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-5 w-full max-w-xl" />
        </div>
        <Skeleton className="hidden h-9 w-44 rounded-md sm:block" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {["w-20", "w-16", "w-20", "w-18", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-8 shrink-0 rounded-md ${width}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
      <div className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2.5 border-b border-line px-5 py-4 last:border-b-0">
            <div className="flex items-center justify-between gap-6">
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-3.5 w-14 shrink-0" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** One handoff while it loads: the transcript on the left, the panel on the right. */
export function HandoffSkeleton() {
  return (
    <Loading label="Loading the handoff" className="flex flex-col gap-6">
      <Skeleton className="h-4 w-16" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full max-w-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4 rounded-md border border-line bg-surface p-5">
          {["w-2/3", "w-4/5", "w-1/2", "w-3/4"].map((width, i) => (
            <div key={i} className={i % 2 ? "flex justify-end" : "flex"}>
              <Skeleton className={`h-16 rounded-md ${width}`} />
            </div>
          ))}
          <Skeleton className="mt-2 h-28 w-full rounded-md" />
        </div>
        <div className="flex flex-col gap-4">
          {["h-40", "h-56", "h-32"].map((height, i) => (
            <Skeleton key={i} className={`w-full rounded-md ${height}`} />
          ))}
        </div>
      </div>
    </Loading>
  );
}
