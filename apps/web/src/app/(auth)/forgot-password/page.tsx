import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title="Reset your password">
        Enter the email you log in with and we will send you a link to choose a new password.
      </AuthHeading>
      <ForgotPasswordForm />
    </>
  );
}
