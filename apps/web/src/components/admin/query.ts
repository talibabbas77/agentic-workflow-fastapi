/** Search params of a console page, read on the server and passed to its view. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** One query parameter's value, or undefined when it is missing or empty. */
export function param(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/** The value when it is one of the allowed ones, so a hand-edited URL cannot break the page. */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((option) => option === value);
}

/** A page number from the URL: a whole number from 1, else 1. */
export function pageParam(params: SearchParams) {
  const page = Number(param(params, "page"));
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

/** Build a console URL from the current filters, leaving out empty ones and page 1. */
export function queryHref(path: string, params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || (key === "page" && value === 1)) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
