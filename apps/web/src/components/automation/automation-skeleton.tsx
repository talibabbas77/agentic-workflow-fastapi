import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";

/** The automation page while it loads: a header, then the rules, Slack, and webhook cards. */
export function AutomationSkeleton() {
  return (
    <Loading label="Loading automation" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      {["h-56", "h-36", "h-40"].map((height, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className={`w-full rounded-md ${height}`} />
        </div>
      ))}
    </Loading>
  );
}
