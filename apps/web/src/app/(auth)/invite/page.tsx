import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/components/auth/auth-skeleton";
import { InviteFlow } from "@/components/auth/invite-flow";

export const metadata: Metadata = { title: "Join a workspace" };

export default function InvitePage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <InviteFlow />
    </Suspense>
  );
}
