import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches a widget page: back link, name and meta line, then settings, keys, and install. */
export function WidgetSkeleton() {
  return (
    <Loading label="Loading widget" className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <Skeleton className="h-4 w-20" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-9 w-64 max-w-full" />
        </div>
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-[30rem] w-full rounded-md" />
      <Skeleton className="h-56 w-full rounded-md" />
      <Skeleton className="h-80 w-full rounded-md" />
    </Loading>
  );
}
