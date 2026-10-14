import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** In-page placeholder while page data streams in: a header and one card, like most pages. */
export function PageSkeleton() {
  return (
    <Loading className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full rounded-md" />
    </Loading>
  );
}

/** A list page: header with its main action, then a table of rows. */
export function ListPageSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <Loading label={label} className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-full max-w-xl" />
        </div>
        <Skeleton className="hidden h-10 w-40 rounded-md sm:block" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-md border border-line">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-none" />
        ))}
      </div>
    </Loading>
  );
}
