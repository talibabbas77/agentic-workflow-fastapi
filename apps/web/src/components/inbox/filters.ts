import type { HandoffReason, HandoffStatus, paths } from "@docent/api-client";

export type InboxView = "list" | "board";
export type StatusFilter = "active" | "all" | HandoffStatus;
export type InboxSort = "newest" | "oldest" | "updated" | "priority";

/** What the inbox shows. Kept in the URL so a reload or a shared link keeps it. */
export type InboxFilters = {
  status: StatusFilter;
  /** "any", "me", "unassigned", or a member's id. */
  assignee: string;
  /** A ticket type id, or "" for any. */
  ticketType: string;
  reason: HandoffReason | "";
  q: string;
  sort: InboxSort;
  unread: boolean;
};

export const DEFAULT_FILTERS: InboxFilters = {
  status: "active",
  assignee: "any",
  ticketType: "",
  reason: "",
  q: "",
  sort: "newest",
  unread: false,
};

export const PAGE_SIZE = 25;

const STATUS_FILTERS: StatusFilter[] = ["active", "all", "open", "assigned", "waiting", "resolved"];
const SORTS: InboxSort[] = ["newest", "oldest", "updated", "priority"];
const REASONS: HandoffReason[] = [
  "no_source",
  "low_confidence",
  "user_requested",
  "restricted_topic",
  "repeated_failure",
  "cap_reached",
];
const ID = /^[0-9a-f-]{36}$/i;

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function readView(params: Params): InboxView {
  return one(params, "view") === "board" ? "board" : "list";
}

/** Filters from the page's search params. Anything unknown falls back to the default. */
export function readFilters(params: Params): InboxFilters {
  const status = one(params, "status") as StatusFilter | undefined;
  const sort = one(params, "sort") as InboxSort | undefined;
  const reason = one(params, "reason") as HandoffReason | undefined;
  const assignee = one(params, "assignee") ?? "any";
  const ticketType = one(params, "type") ?? "";
  return {
    status: status && STATUS_FILTERS.includes(status) ? status : DEFAULT_FILTERS.status,
    assignee: ["any", "me", "unassigned"].includes(assignee) || ID.test(assignee) ? assignee : "any",
    ticketType: ID.test(ticketType) ? ticketType : "",
    reason: reason && REASONS.includes(reason) ? reason : "",
    q: (one(params, "q") ?? "").slice(0, 200),
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    unread: one(params, "unread") === "1",
  };
}

/** The search string for the page URL: only what differs from the defaults. */
export function toSearch(filters: InboxFilters, view: InboxView) {
  const params = new URLSearchParams();
  if (view === "board") params.set("view", "board");
  if (filters.status !== DEFAULT_FILTERS.status) params.set("status", filters.status);
  if (filters.assignee !== "any") params.set("assignee", filters.assignee);
  if (filters.ticketType) params.set("type", filters.ticketType);
  if (filters.reason) params.set("reason", filters.reason);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.unread) params.set("unread", "1");
  const text = params.toString();
  return text ? `?${text}` : "";
}

type ListQuery = NonNullable<paths["/v1/inbox"]["get"]["parameters"]["query"]>;
type BoardQuery = NonNullable<paths["/v1/inbox/board"]["get"]["parameters"]["query"]>;

function statusList(status: StatusFilter): HandoffStatus[] {
  if (status === "all") return [];
  if (status === "active") return ["open", "assigned", "waiting"];
  return [status];
}

export function boardQuery(filters: InboxFilters): BoardQuery {
  return {
    assignee: filters.assignee === "any" ? undefined : filters.assignee,
    ticket_type_id: filters.ticketType || undefined,
    reason: filters.reason ? [filters.reason] : undefined,
    q: filters.q.trim() || undefined,
  };
}

export function listQuery(filters: InboxFilters, limit = PAGE_SIZE, cursor?: string): ListQuery {
  return {
    ...boardQuery(filters),
    status: statusList(filters.status),
    sort: filters.sort,
    unread: filters.unread || undefined,
    limit,
    cursor,
  };
}

export function isFiltered(filters: InboxFilters) {
  return (
    filters.assignee !== "any" ||
    Boolean(filters.ticketType) ||
    Boolean(filters.reason) ||
    Boolean(filters.q.trim()) ||
    filters.unread ||
    filters.status !== DEFAULT_FILTERS.status
  );
}
