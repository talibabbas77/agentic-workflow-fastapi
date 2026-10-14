"use client";

import type {
  Assignee,
  HandoffStatus,
  InboxBoard,
  InboxCounts,
  InboxItem,
  InboxPage,
  TicketType,
} from "@docent/api-client";
import { KanbanIcon, ListBulletsIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { InboxIllustration } from "@/components/illustrations/illustrations";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import {
  boardQuery,
  DEFAULT_FILTERS,
  isFiltered,
  listQuery,
  PAGE_SIZE,
  toSearch,
  type InboxFilters,
  type InboxView,
  type StatusFilter,
} from "./filters";
import { InboxBoardView } from "./inbox-board";
import { InboxList } from "./inbox-list";
import { reasons, statusLabel } from "./inbox-meta";

/** New handoffs show up within a few seconds while the page is open. */
const POLL_MS = 4000;

const ZERO: InboxCounts = { open: 0, assigned: 0, waiting: 0, resolved: 0, unread: 0, mine: 0, unassigned: 0 };

export function InboxManager({
  initialView,
  initialFilters,
  initialPage,
  initialBoard,
  ticketTypes,
  assignees,
}: {
  initialView: InboxView;
  initialFilters: InboxFilters;
  initialPage: InboxPage | null;
  initialBoard: InboxBoard | null;
  ticketTypes: TicketType[];
  assignees: Assignee[];
}) {
  const toast = useToast();
  const [view, setView] = useState(initialView);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(initialPage);
  const [board, setBoard] = useState(initialBoard);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState(initialFilters.q);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const latest = useRef(0);
  const moving = useRef(0);
  const shown = useRef(page?.items.length ?? PAGE_SIZE);
  useEffect(() => {
    shown.current = page?.items.length ?? PAGE_SIZE;
  }, [page]);

  const counts = (view === "list" ? page?.counts : board?.counts) ?? page?.counts ?? board?.counts ?? ZERO;
  const total = counts.open + counts.assigned + counts.waiting + counts.resolved;

  const load = useCallback(
    async (nextView: InboxView, next: InboxFilters, quiet = false) => {
      const id = ++latest.current;
      if (!quiet) setLoading(true);
      if (nextView === "list") {
        // A refresh keeps everything already shown, up to 100 rows.
        const limit = quiet ? Math.min(100, Math.max(PAGE_SIZE, shown.current)) : PAGE_SIZE;
        const result = await request(api.GET("/v1/inbox", { params: { query: listQuery(next, limit) } }));
        if (id !== latest.current) return;
        if (result.ok) setPage(result.data);
        else if (!quiet) toast({ tone: "error", title: "Could not load the inbox", description: result.error.message });
      } else {
        const result = await request(api.GET("/v1/inbox/board", { params: { query: boardQuery(next) } }));
        if (id !== latest.current || moving.current > 0) return;
        if (result.ok) setBoard(result.data);
        else if (!quiet) toast({ tone: "error", title: "Could not load the board", description: result.error.message });
      }
      if (!quiet) setLoading(false);
    },
    [toast],
  );

  usePoll(true, () => (moving.current > 0 ? Promise.resolve() : load(view, filters, true)), POLL_MS);

  function apply(nextView: InboxView, next: InboxFilters) {
    setView(nextView);
    setFilters(next);
    // Keep the URL in step without asking the server to render the page again.
    window.history.replaceState(null, "", `/app/inbox${toSearch(next, nextView)}`);
    void load(nextView, next);
  }

  const update = (patch: Partial<InboxFilters>) => apply(view, { ...filters, ...patch });

  // Typing searches after a short pause.
  useEffect(() => {
    if (query === filters.q) return;
    const timer = window.setTimeout(() => update({ q: query }), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function loadMore() {
    if (!page?.next_cursor) return;
    setLoadingMore(true);
    const result = await request(
      api.GET("/v1/inbox", { params: { query: listQuery(filters, PAGE_SIZE, page.next_cursor) } }),
    );
    setLoadingMore(false);
    if (result.ok) {
      setPage((current) =>
        current
          ? {
              ...result.data,
              items: [...current.items, ...result.data.items.filter((i) => !current.items.some((c) => c.id === i.id))],
            }
          : result.data,
      );
    } else {
      toast({ tone: "error", title: "Could not load more", description: result.error.message });
    }
  }

  async function move(item: InboxItem, to: HandoffStatus, viaKeyboard: boolean) {
    if (!board) return;
    moving.current += 1;
    const before = board;
    setBoard(placed(board, { ...item, status: to }));
    if (viaKeyboard) setFocusId(item.id);
    const result = await request(
      api.PATCH("/v1/inbox/{escalation_id}", { params: { path: { escalation_id: item.id } }, body: { status: to } }),
    );
    moving.current -= 1;
    if (!result.ok) {
      setBoard(before);
      if (viaKeyboard) setFocusId(item.id);
      setAnnouncement(`Could not move it: ${result.error.message}`);
      toast({ tone: "error", title: "Could not move the handoff", description: result.error.message });
      return;
    }
    setBoard((current) => (current ? placed(current, result.data.item) : current));
    setAnnouncement(`Moved to ${statusLabel[to]}: ${item.issue}`);
    void load("board", filters, true);
  }

  const clearFocus = useCallback(() => setFocusId(null), []);
  const hasHandoffs = total > 0;
  const statusTabs: { value: StatusFilter; label: string; count?: number }[] = [
    { value: "active", label: "Not resolved", count: counts.open + counts.assigned + counts.waiting },
    { value: "open", label: "Open", count: counts.open },
    { value: "assigned", label: "Assigned", count: counts.assigned },
    { value: "waiting", label: "Waiting", count: counts.waiting },
    { value: "resolved", label: "Resolved", count: counts.resolved },
    { value: "all", label: "All" },
  ];
  const items = page?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inbox"
        description="Conversations the agent handed to your team. Reply by email, leave notes for each other, and move each one along."
        actions={<ViewToggle view={view} onChange={(next) => apply(next, filters)} />}
      />

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-ink-muted" aria-live="polite">
        <span className={cn("tabular-nums", counts.unread > 0 && "font-medium text-rust")}>
          {formatCount(counts.unread)} unread
        </span>
        <span className="tabular-nums">{formatCount(counts.mine)} assigned to you</span>
        <span className="tabular-nums">{formatCount(counts.unassigned)} with nobody assigned</span>
      </p>

      <div className="flex flex-col gap-4">
        {view === "list" ? (
          <div
            role="group"
            aria-label="Status"
            className="relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={filters.status === tab.value}
                onClick={() => update({ status: tab.value })}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm whitespace-nowrap transition-colors duration-150",
                  filters.status === tab.value
                    ? "border-ink bg-ink font-medium text-paper"
                    : "border-line-strong bg-surface text-ink hover:bg-surface-2",
                )}
              >
                {tab.label}
                {tab.count !== undefined ? (
                  <span
                    className={cn(
                      "tabular-nums",
                      filters.status === tab.value ? "text-paper/80" : "text-ink-muted",
                    )}
                  >
                    {formatCount(tab.count)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 sm:col-span-4 lg:col-span-1">
            <Field label="Search">
              <div className="relative">
                <MagnifyingGlassIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Issue, summary, or email"
                  maxLength={200}
                  className="pl-9"
                />
              </div>
            </Field>
          </div>
          <Field label="Assignee">
            <Select value={filters.assignee} onChange={(event) => update({ assignee: event.target.value })}>
              <option value="any">Anyone</option>
              <option value="me">Me</option>
              <option value="unassigned">Nobody</option>
              {assignees
                .filter((a) => !a.is_you)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Ticket type">
            <Select value={filters.ticketType} onChange={(event) => update({ ticketType: event.target.value })}>
              <option value="">Any type</option>
              {ticketTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason">
            <Select
              value={filters.reason}
              onChange={(event) => update({ reason: event.target.value as InboxFilters["reason"] })}
            >
              <option value="">Any reason</option>
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          {view === "list" ? (
            <Field label="Sort">
              <Select
                value={filters.sort}
                onChange={(event) => update({ sort: event.target.value as InboxFilters["sort"] })}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="updated">Recently changed</option>
                <option value="priority">Highest priority</option>
              </Select>
            </Field>
          ) : (
            <div aria-hidden="true" className="hidden lg:block" />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {view === "list" ? (
            <label className="inline-flex items-center gap-2 text-base text-ink">
              <input
                type="checkbox"
                checked={filters.unread}
                onChange={(event) => update({ unread: event.target.checked })}
                className="size-4 accent-rust"
              />
              Only unread
            </label>
          ) : (
            <p className="text-sm text-ink-muted">
              Drag a card to another column, or use its Move button to change its status.
            </p>
          )}
          {isFiltered(filters) ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<XIcon aria-hidden="true" className="size-4" />}
              onClick={() => {
                setQuery("");
                apply(view, DEFAULT_FILTERS);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <div aria-busy={loading || undefined} className={cn("transition-opacity duration-150", loading && "opacity-60")}>
        {!hasHandoffs && !isFiltered(filters) ? (
          <EmptyState
            illustration={<InboxIllustration />}
            title="No handoffs yet"
            action={
              <ButtonLink href="/app/agent" variant="secondary">
                Try a handoff in the preview
              </ButtonLink>
            }
          >
            <p>
              When the agent cannot back up an answer, or a customer asks for a person, the conversation lands here with
              a short summary, and your team replies by email.
            </p>
          </EmptyState>
        ) : view === "board" ? (
          board ? (
            <InboxBoardView board={board} onMove={move} focusId={focusId} onFocused={clearFocus} />
          ) : (
            <BoardLoading />
          )
        ) : items.length === 0 ? (
          <EmptyState title="Nothing matches these filters">
            <p>Try another status or clear the filters to see every handoff.</p>
          </EmptyState>
        ) : (
          <InboxList
            items={items}
            hasMore={Boolean(page?.next_cursor)}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/** Put an item in the column for its status, at the top, and fix the totals. */
function placed(board: InboxBoard, item: InboxItem): InboxBoard {
  return {
    ...board,
    columns: board.columns.map((column) => {
      const had = column.items.some((i) => i.id === item.id);
      const rest = column.items.filter((i) => i.id !== item.id);
      if (column.status === item.status) {
        return { ...column, items: [item, ...rest], total: column.total + (had ? 0 : 1) };
      }
      return had ? { ...column, items: rest, total: Math.max(0, column.total - 1) } : column;
    }),
  };
}

function ViewToggle({ view, onChange }: { view: InboxView; onChange: (view: InboxView) => void }) {
  const options = [
    { value: "list" as const, label: "List", icon: ListBulletsIcon },
    { value: "board" as const, label: "Board", icon: KanbanIcon },
  ];
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-md border border-line-strong bg-surface-2 p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm transition-colors duration-150",
            view === value ? "bg-surface font-medium text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function BoardLoading() {
  return (
    <Loading label="Loading the board" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-line p-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      ))}
    </Loading>
  );
}
