import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSkeleton } from "@/components/auth/auth-skeleton";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "Confirm your email" };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthSkeleton />}>
      <VerifyEmail />
    </Suspense>
  );
}
