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

  /**
   * Run a request. Pending ends when the request fails or the success handler
   * returns. A handler that navigates away never returns, so the form stays pending.
   */
  async function run<T>(call: () => Promise<Result<T>>, onSuccess: (data: T) => void | Promise<void>) {
    setPending(true);
    setError(null);
    setLocal({});
    const result = await call();
    if (result.ok) await onSuccess(result.data);
    else setError(result.error);
    setPending(false);
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

  /** The message for `name`, or for any item inside it, such as `notify_emails.0` for `notify_emails`. */
  const fieldError = (name: string) => {
    if (local[name]) return local[name];
    const fields = error?.fields ?? {};
    if (fields[name]) return fields[name];
    return Object.entries(fields).find(([key]) => key.startsWith(`${name}.`))?.[1];
  };

  /** The top-level message, unless it only says that fields need attention. */
  const formError = error && !(error.code === "invalid_request" && error.fields) ? error.message : null;

  return { pending, error, run, check, fieldError, formError };
}
