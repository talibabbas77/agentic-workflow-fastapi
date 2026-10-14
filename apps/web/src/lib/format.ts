import type { Role } from "@docent/api-client";

// Fixed locale and time zone so server and browser render the same text.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function formatDate(iso: string) {
  return dateFormat.format(new Date(iso));
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. Falls back to the date without a clock. */
export function formatRelative(iso: string, now: number | null) {
  if (now === null) return formatDate(iso);
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / (60 * 24))} d ago`;
  return formatDate(iso);
}

const countFormat = new Intl.NumberFormat("en-US");

export function formatCount(n: number) {
  return countFormat.format(n);
}

const moneyFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$35.00" from cents, or "-$14.50" for a credit. */
export function formatMoney(cents: number) {
  return `${cents < 0 ? "-" : ""}$${moneyFormat.format(Math.abs(cents) / 100)}`;
}

const smallMoneyFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 2 });

/** "$0.0007": two significant digits under a dollar, so a tiny amount never shows as "$0.00". */
function smallMoney(sign: string, usd: number) {
  const small = smallMoneyFormat.format(usd);
  return `${sign}$${/^0\.\d$/.test(small) ? `${small}0` : small}`;
}

/**
 * "$128.00" from micro dollars (1 USD = 1,000,000), as model costs are kept.
 * Whole cents from one cent up; below that, two significant digits, so a
 * cost of a fraction of a cent does not show as nothing.
 */
export function formatMicros(micros: number) {
  const usd = Math.abs(micros) / 1_000_000;
  const sign = micros < 0 ? "-" : "";
  if (usd === 0 || usd >= 0.01) return `${sign}$${moneyFormat.format(usd)}`;
  return smallMoney(sign, usd);
}

/** "$0.00072": a cost per reply, with two significant digits under a dollar. */
export function formatPerReply(micros: number) {
  const usd = Math.abs(micros) / 1_000_000;
  const sign = micros < 0 ? "-" : "";
  if (usd === 0 || usd >= 1) return `${sign}$${moneyFormat.format(usd)}`;
  return smallMoney(sign, usd);
}

const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** "98.7%" from a fraction. */
export function formatPercent(fraction: number) {
  return percentFormat.format(fraction);
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** "Oct 14, 2026, 14:05 UTC". */
export function formatDateTime(iso: string) {
  return `${dateTimeFormat.format(new Date(iso))} UTC`;
}

/** "45 s", "12 min", "3 h", "2 d": how long something has waited. */
export function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

/** "document" or "documents" for a count. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`) {
  return n === 1 ? singular : pluralForm;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const roleLabel: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Agent",
};

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
