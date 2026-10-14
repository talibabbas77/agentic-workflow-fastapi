import { toApiError, type ApiError } from "@docent/api-client";

export type Result<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: ApiError; status: number };

export type FetchOutcome<T> = { data?: T; error?: unknown; response: Response };

export const NETWORK_ERROR: ApiError = {
  code: "network_error",
  message: "Could not reach Docent. Check your connection and try again.",
};

/** Turn an openapi-fetch call into a flat result. Never throws. */
export async function settle<T>(call: Promise<FetchOutcome<T>>): Promise<Result<T>> {
  try {
    const { data, error, response } = await call;
    if (response.ok) {
      return { ok: true, data: data as T, status: response.status };
    }
    return { ok: false, error: toApiError(error, response.status), status: response.status };
  } catch {
    return { ok: false, error: NETWORK_ERROR, status: 0 };
  }
}
