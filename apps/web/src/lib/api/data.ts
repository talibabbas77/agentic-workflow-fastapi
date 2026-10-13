import type { Members, Onboarding, Tenant } from "@docent/api-client";
import { redirect } from "next/navigation";
import { settle, type Result } from "./result";
import { loginPath, serverApi } from "./server";

async function guard<T>(result: Result<T>): Promise<Result<T>> {
  if (!result.ok && result.status === 401) redirect(await loginPath());
  return result;
}

export async function getOnboarding(): Promise<Onboarding> {
  const client = await serverApi();
  const result = await guard(await settle(client.GET("/v1/onboarding")));
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export async function getTenant(): Promise<Tenant> {
  const client = await serverApi();
  const result = await guard(await settle(client.GET("/v1/tenant")));
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Members and invitations, or a 403 result for agents. */
export async function getMembers(): Promise<Result<Members>> {
  const client = await serverApi();
  return guard(await settle(client.GET("/v1/members")));
}
