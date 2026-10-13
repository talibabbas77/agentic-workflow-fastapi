import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <AuthHeading title="Log in">Welcome back. Pick up where your team left off.</AuthHeading>
      <LoginForm />
    </>
  );
}
