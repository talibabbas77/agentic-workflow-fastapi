import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches an auth page: heading, one line of copy, then the form. */
export function AuthSkeleton() {
  return (
    <Loading className="flex flex-col gap-5">
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="mt-3 h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </Loading>
  );
}
