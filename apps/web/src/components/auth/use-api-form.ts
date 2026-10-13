"use client";

import type { ApiError } from "@docent/api-client";
import { useState } from "react";
import type { Result } from "@/lib/api/result";

/**
 * Pending state and API errors for a form. `fieldError(name)` returns the API's
 * message for that field, falling back to client-side checks.
 */
export function useApiForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});

  async function run<T>(
    call: () => Promise<Result<T>>,
    onSuccess: (data: T) => void | Promise<void>,
  ): Promise<boolean> {
    setPending(true);
    setError(null);
    setLocal({});
    const result = await call();
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return false;
    }
    await onSuccess(result.data);
    return true;
  }

  /** Show client-side problems without a request. Returns true when there are none. */
  function check(problems: Record<string, string | false | undefined>) {
    const found = Object.fromEntries(
      Object.entries(problems).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    setLocal(found);
    if (Object.keys(found).length > 0) setError(null);
    return Object.keys(found).length === 0;
  }

  const fieldError = (name: string) => local[name] ?? error?.fields?.[name] ?? undefined;

  /** The top-level message, unless it only says that fields need attention. */
  const formError = error && !(error.code === "invalid_request" && error.fields) ? error.message : null;

  return { pending, setPending, error, setError, run, check, fieldError, formError };
}
