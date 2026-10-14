import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** A console page while its data loads: a header, a row of figures, then a table. */
export function ConsoleSkeleton({ label, tiles = 6, rows = 5 }: { label: string; tiles?: number; rows?: number }) {
  return (
    <Loading label={label} className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      {tiles > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: tiles }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-md" />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-px overflow-hidden rounded-md border border-line">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-none" />
        ))}
      </div>
    </Loading>
  );
}

/** The workspace list: header, filters, then rows. */
export function WorkspacesSkeleton({ label = "Loading workspaces" }: { label?: string }) {
  return (
    <Loading label={label} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-md border border-line">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-none" />
        ))}
      </div>
    </Loading>
  );
}

/** One workspace: header, figures, then the subscription beside the actions. */
export function WorkspaceSkeleton() {
  return (
    <Loading label="Loading the workspace" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-md" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-80 w-full rounded-md" />
        <Skeleton className="h-80 w-full rounded-md" />
      </div>
    </Loading>
  );
}
