import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Honest placeholder for parts of Docent that are not built yet. */
export function NotYet({
  title,
  description,
  illustration,
  emptyTitle,
  children,
}: {
  title: string;
  description: string;
  illustration: ReactNode;
  emptyTitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={title} description={description} />
      <EmptyState illustration={illustration} title={emptyTitle}>
        {children}
        <p className="text-sm text-ink-muted">This part of Docent is not available yet.</p>
      </EmptyState>
    </div>
  );
}
