import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <>
      <AuthHeading title="Create your workspace">
        Set up Docent for your team. You will teach the agent from your docs next.
      </AuthHeading>
      <SignupForm />
    </>
  );
}
