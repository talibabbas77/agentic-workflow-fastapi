import { Skeleton } from "@/components/ui/skeleton";

/** In-page placeholder while page data streams in: a header and one card, like most pages. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full rounded-md" />
    </div>
  );
}
