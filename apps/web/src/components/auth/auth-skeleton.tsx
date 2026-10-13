import { Skeleton } from "@/components/ui/skeleton";

export function AuthSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="mt-3 h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
