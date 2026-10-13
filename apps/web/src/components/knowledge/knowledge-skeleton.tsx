import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches the knowledge page: header, totals, sources table, and test search. */
export function KnowledgeSkeleton() {
  return (
    <Loading label="Loading knowledge" className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-full max-w-xl" />
        </div>
        <Skeleton className="hidden h-10 w-32 rounded-md sm:block" />
      </div>
      <Skeleton className="h-28 w-full rounded-md" />
      <div className="flex flex-col gap-px overflow-hidden rounded-md border border-line">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-none" />
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-md" />
    </Loading>
  );
}

/** Matches a source page: back link, title, meta lines, and the documents table. */
export function SourceSkeleton() {
  return (
    <Loading label="Loading source" className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-9 w-72 max-w-full" />
        </div>
        <Skeleton className="h-5 w-full max-w-lg" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-72 w-full rounded-md" />
    </Loading>
  );
}
