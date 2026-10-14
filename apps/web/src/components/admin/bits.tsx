"use client";

import { CaretLeftIcon, CaretRightIcon, EyeSlashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";

/** Said on every page that shows a workspace's data. */
export function PrivacyNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-ink-muted", className)}>
      <EyeSlashIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        Counts and metadata only. The console never shows conversations, messages, knowledge content, or customer
        memory.
      </span>
    </p>
  );
}

/** One headline number with its label and a short note. Sits in a `<dl>`. */
export function StatTile({
  label,
  value,
  note,
  warn = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  warn?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-line bg-surface px-5 py-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
        {warn ? <WarningCircleIcon aria-hidden="true" className="size-5 shrink-0 text-rust" weight="bold" /> : null}
        <span className="truncate">{value}</span>
      </dd>
      {note ? <dd className="text-sm text-ink-muted">{note}</dd> : null}
    </div>
  );
}

/** "1 to 25 of 73" with previous and next links that keep the other filters. */
export function Pager({
  page,
  perPage,
  total,
  href,
  noun,
}: {
  page: number;
  perPage: number;
  total: number;
  href: (page: number) => string;
  noun: string;
}) {
  const last = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage && page === 1) return null;
  const first = Math.min(total, (page - 1) * perPage + 1);
  const end = Math.min(total, page * perPage);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-muted tabular-nums">
        {total === 0 || first > total
          ? `No ${noun} on page ${page}`
          : `${formatCount(first)} to ${formatCount(end)} of ${formatCount(total)} ${noun}`}
      </p>
      <div className="flex gap-2">
        <PageLink to={page > 1 ? href(Math.min(page - 1, last)) : null} rel="prev">
          <CaretLeftIcon aria-hidden="true" className="size-3.5" weight="bold" />
          Previous
        </PageLink>
        <PageLink to={page < last ? href(page + 1) : null} rel="next">
          Next
          <CaretRightIcon aria-hidden="true" className="size-3.5" weight="bold" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({ to, rel, children }: { to: string | null; rel: string; children: ReactNode }) {
  if (to === null) {
    return (
      <Button variant="secondary" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <ButtonLink href={to} rel={rel} variant="secondary" size="sm">
      {children}
    </ButtonLink>
  );
}
