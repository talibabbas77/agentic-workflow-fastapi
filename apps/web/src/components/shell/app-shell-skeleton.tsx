import { Skeleton } from "@/components/ui/skeleton";

/** Static shell shown while the session streams in. Matches the real layout to avoid a jump. */
export function AppShellSkeleton() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]" aria-busy="true">
      <aside className="hidden h-dvh flex-col border-r border-line lg:flex">
        <div className="flex h-14 items-center px-5">
          <Skeleton className="h-6 w-26" />
        </div>
        <div className="px-3 pt-2 pb-4">
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
        <div className="flex flex-col gap-2 px-3">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-line px-4 sm:px-8 lg:px-10">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="size-8 rounded-full" />
        </div>
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-10">
          <PageSkeleton />
        </div>
      </div>
    </div>
  );
}

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
