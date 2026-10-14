import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";

/** The sentence at the top of a tab, with its main action beside it. */
export function PanelIntro({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <p className="max-w-2xl text-base text-ink-muted">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** An empty tab: an icon tile, what the list will hold, and how it fills. */
export function PanelEmpty({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <EmptyState
      illustration={
        <span className="inline-flex size-12 items-center justify-center rounded-md border border-line-strong text-ink-muted">
          {icon}
        </span>
      }
      title={title}
      action={action}
    >
      <p>{children}</p>
    </EmptyState>
  );
}
