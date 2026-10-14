"use client";

import type { AdminWorkspaceRow, AdminWorkspaces, PlanId, WorkspaceSort, WorkspaceState } from "@docent/api-client";
import { MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { formatCount, formatDate, formatMicros, formatPerReply } from "@/lib/format";
import { Pager, PrivacyNote } from "./bits";
import { planOptions, sortOptions, StateBadge, stateOptions } from "./labels";
import { queryHref } from "./query";

export type WorkspaceFilters = {
  q?: string;
  plan?: PlanId;
  status?: WorkspaceState;
  sort: WorkspaceSort;
  page: number;
};

const PATH = "/admin/workspaces";

export function WorkspacesView({ data, filters }: { data: AdminWorkspaces; filters: WorkspaceFilters }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const filtered = Boolean(filters.q || filters.plan || filters.status);

  function go(next: Partial<WorkspaceFilters>) {
    const merged = { ...filters, ...next };
    startTransition(() => router.push(queryHref(PATH, { ...merged, sort: merged.sort === "newest" ? null : merged.sort })));
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    go({ q: String(form.get("q") ?? "").trim() || undefined, page: 1 });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeader
          title="Workspaces"
          description="Every workspace, where it stands, and this month's money. Search by name, slug, or a member's email."
        />
        <PrivacyNote />
      </div>

      <form
        key={JSON.stringify(filters)}
        role="search"
        aria-label="Workspaces"
        onSubmit={search}
        className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
      >
        <div className="col-span-2 lg:col-span-1">
          <Field label="Search">
            <div className="flex gap-2">
              <Input name="q" type="search" defaultValue={filters.q} placeholder="Name, slug, or email" maxLength={200} />
              <Button type="submit" variant="secondary" aria-label="Search" className="shrink-0 px-3" loading={pending}>
                {pending ? null : <MagnifyingGlassIcon aria-hidden="true" className="size-4" />}
              </Button>
            </div>
          </Field>
        </div>
        <Field label="Plan">
          <Select
            defaultValue={filters.plan ?? ""}
            onChange={(event) => go({ plan: (event.target.value || undefined) as PlanId | undefined, page: 1 })}
          >
            <option value="">All plans</option>
            {planOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            defaultValue={filters.status ?? ""}
            onChange={(event) =>
              go({ status: (event.target.value || undefined) as WorkspaceState | undefined, page: 1 })
            }
          >
            <option value="">Any status</option>
            {stateOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="col-span-2 lg:col-span-1">
          <Field label="Sort">
            <Select
              defaultValue={filters.sort}
              onChange={(event) => go({ sort: event.target.value as WorkspaceSort, page: 1 })}
            >
              {sortOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </form>

      <div aria-busy={pending || undefined} className={cn("flex flex-col gap-4 transition-opacity", pending && "opacity-60")}>
        {data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "No workspaces match" : "No workspaces yet"}
            action={
              filtered ? (
                <ButtonLink href={PATH} variant="secondary">
                  Clear filters
                </ButtonLink>
              ) : null
            }
          >
            {filtered ? <p>Try another search, or clear the filters.</p> : <p>Workspaces appear here as people sign up.</p>}
          </EmptyState>
        ) : (
          <Card aria-label="Workspaces" className="min-w-0">
            <WorkspacesTable rows={data.items} />
            <WorkspaceCards rows={data.items} />
          </Card>
        )}
        <Pager
          page={data.page}
          perPage={data.per_page}
          total={data.total}
          noun="workspaces"
          href={(page) => queryHref(PATH, { ...filters, sort: filters.sort === "newest" ? null : filters.sort, page })}
        />
      </div>
    </div>
  );
}

const th = "px-3 py-2.5 font-medium whitespace-nowrap";
const num = "px-3 py-3 text-right whitespace-nowrap tabular-nums";

function WorkspacesTable({ rows }: { rows: AdminWorkspaceRow[] }) {
  return (
    <div className="hidden overflow-x-auto xl:block">
      <table className="w-full text-left text-base">
        <thead>
          <tr className="border-b border-line text-sm text-ink-muted">
            <th scope="col" className={cn(th, "pl-6")}>
              Workspace
            </th>
            <th scope="col" className={th}>
              Status
            </th>
            <th scope="col" className={th}>
              Plan
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Members
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Replies used
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Model cost
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Revenue
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Margin
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Cost per reply
            </th>
            <th scope="col" className={cn(th, "pr-6")}>
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60"
            >
              <td className="max-w-64 py-3 pr-3 pl-6">
                <WorkspaceName row={row} />
              </td>
              <td className="px-3 py-3">
                <StateBadge state={row.state} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                <PlanCell row={row} />
              </td>
              <td className={num}>{formatCount(row.members)}</td>
              <td className={num}>
                <Replies row={row} />
              </td>
              <td className={num}>{formatMicros(row.figures.cost_micros)}</td>
              <td className={num}>{formatMicros(row.figures.revenue_micros)}</td>
              <td className={num}>{formatMicros(row.figures.margin_micros)}</td>
              <td className={num}>
                <CostPerReply row={row} />
              </td>
              <td className="py-3 pr-6 pl-3 whitespace-nowrap text-ink-muted">{formatDate(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Below the widest screens, one block per workspace with the same figures, labeled. */
function WorkspaceCards({ rows }: { rows: AdminWorkspaceRow[] }) {
  return (
    <ul className="xl:hidden">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-3 border-b border-line px-5 py-4 last:border-b-0 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <WorkspaceName row={row} />
            <StateBadge state={row.state} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-4">
            <Fact label="Plan">
              <PlanCell row={row} />
            </Fact>
            <Fact label="Members">{formatCount(row.members)}</Fact>
            <Fact label="Replies used">
              <Replies row={row} />
            </Fact>
            <Fact label="Model cost">{formatMicros(row.figures.cost_micros)}</Fact>
            <Fact label="Revenue">{formatMicros(row.figures.revenue_micros)}</Fact>
            <Fact label="Margin">{formatMicros(row.figures.margin_micros)}</Fact>
            <Fact label="Cost per reply">
              <CostPerReply row={row} />
            </Fact>
            <Fact label="Created">{formatDate(row.created_at)}</Fact>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-base text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function WorkspaceName({ row }: { row: AdminWorkspaceRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <Link
        prefetch={false}
        href={`/admin/workspaces/${row.id}`}
        className="truncate rounded-sm font-medium text-ink underline-offset-[3px] hover:underline"
      >
        {row.name}
      </Link>
      <span className="truncate text-sm text-ink-muted">{row.slug}</span>
    </div>
  );
}

function PlanCell({ row }: { row: AdminWorkspaceRow }) {
  return (
    <span>
      {row.plan.name}
      <span className="text-sm text-ink-muted">{row.provider === "stripe" ? ", Stripe" : ""}</span>
    </span>
  );
}

function Replies({ row }: { row: AdminWorkspaceRow }) {
  const { replies_used: used, replies_cap: cap } = row.figures;
  return (
    <span>
      {formatCount(used)}
      <span className="text-sm text-ink-muted">{cap > 0 ? ` of ${formatCount(cap)}` : ", answers off"}</span>
    </span>
  );
}

function CostPerReply({ row }: { row: AdminWorkspaceRow }) {
  const { cost_per_reply_micros: perReply, anomaly } = row.figures;
  if (perReply === null) return <span className="text-ink-subtle">No replies</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {anomaly ? (
        <>
          <WarningCircleIcon aria-hidden="true" className="size-4 shrink-0 text-rust" weight="bold" />
          <span className="sr-only">Anomaly, more than 3 times the median: </span>
        </>
      ) : null}
      <span className={cn(anomaly && "font-medium")}>{formatPerReply(perReply)}</span>
    </span>
  );
}
