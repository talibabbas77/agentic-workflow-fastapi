"use client";

import type { AdminPeople, AdminPerson } from "@docent/api-client";
import { MagnifyingGlassIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";
import { formatDate, formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Pager } from "./bits";
import { queryHref } from "./query";

const PATH = "/admin/people";

export function PeopleView({ data, q }: { data: AdminPeople; q?: string }) {
  const router = useRouter();
  const now = useNow();
  const [pending, startTransition] = useTransition();

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    startTransition(() => router.push(queryHref(PATH, { q: text })));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        description="Every account on Docent, the workspaces it belongs to, and its role in each."
      />
      <form key={q ?? ""} role="search" aria-label="People" onSubmit={search} className="max-w-xl">
        <Field label="Search by email or name">
          <div className="flex gap-2">
            <Input name="q" type="search" defaultValue={q} placeholder="ada@example.com" maxLength={200} />
            <Button type="submit" variant="secondary" loading={pending} icon={<MagnifyingGlassIcon aria-hidden="true" className="size-4" />}>
              Search
            </Button>
          </div>
        </Field>
      </form>

      <div aria-busy={pending || undefined} className={cn("flex flex-col gap-4 transition-opacity", pending && "opacity-60")}>
        {data.items.length === 0 ? (
          <EmptyState
            title={q ? "Nobody matches" : "No accounts yet"}
            action={
              q ? (
                <ButtonLink href={PATH} variant="secondary">
                  Clear the search
                </ButtonLink>
              ) : null
            }
          >
            {q ? <p>No email or name contains &ldquo;{q}&rdquo;.</p> : null}
          </EmptyState>
        ) : (
          <Card aria-label="People" className="min-w-0">
            <ul>
              {data.items.map((person) => (
                <Person key={person.id} person={person} now={now} />
              ))}
            </ul>
          </Card>
        )}
        <Pager
          page={data.page}
          perPage={data.per_page}
          total={data.total}
          noun="people"
          href={(next) => queryHref(PATH, { q, page: next })}
        />
      </div>
    </div>
  );
}

function Person({ person, now }: { person: AdminPerson; now: number | null }) {
  return (
    <li className="grid gap-3 border-b border-line px-5 py-4 last:border-b-0 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-ink">{person.name}</span>
          {person.is_platform_admin ? (
            <Badge tone="accent" className="gap-1">
              <ShieldCheckIcon aria-hidden="true" className="size-3" weight="bold" />
              Platform admin
            </Badge>
          ) : null}
        </span>
        <span className="truncate text-sm text-ink-muted">{person.email}</span>
        <span className="text-sm text-ink-muted">{person.email_verified ? "Email verified" : "Email not verified"}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm text-ink-muted lg:sr-only">Workspaces</span>
        {person.workspaces.length === 0 ? (
          <span className="text-sm text-ink-muted">In no workspace</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {person.workspaces.map((w) => (
              <li key={w.tenant_id} className="flex min-w-0 items-center gap-2">
                <Link
                  prefetch={false}
                  href={`/admin/workspaces/${w.tenant_id}`}
                  className="truncate rounded-sm text-ink underline-offset-[3px] hover:underline"
                >
                  {w.name}
                </Link>
                <RoleBadge role={w.role} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-0.5 text-sm text-ink-muted lg:items-end lg:text-right">
        <span>Signed up {formatDate(person.created_at)}</span>
        <span>{person.last_login_at ? `Last logged in ${formatRelative(person.last_login_at, now)}` : "Not logged in since signing up"}</span>
      </div>
    </li>
  );
}
