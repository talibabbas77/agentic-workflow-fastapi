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
