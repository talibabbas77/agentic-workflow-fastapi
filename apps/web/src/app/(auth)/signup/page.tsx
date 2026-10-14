import type { Metadata } from "next";
import { AuthHeading } from "@/components/auth/auth-heading";
import { SignupForm } from "@/components/auth/signup-form";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { SHOWCASE_APP_URL, SHOWCASE_PUBLIC_URL, SIGNUPS_OPEN } from "@/lib/site";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  if (!SIGNUPS_OPEN) {
    return (
      <>
        <AuthHeading title="Sign-ups are closed here">
          This Docent deployment is a portfolio showcase, so new workspaces are turned off. You can still try the agent
          on two sites with the widget installed.
        </AuthHeading>
        <div className="flex flex-col gap-3">
          <ButtonLink href={SHOWCASE_PUBLIC_URL} target="_blank" rel="noopener noreferrer" block>
            Try it as a visitor on Lumen Notes
          </ButtonLink>
          <ButtonLink href={SHOWCASE_APP_URL} target="_blank" rel="noopener noreferrer" variant="secondary" block>
            Try it signed in on Parcelwise
          </ButtonLink>
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          Already have an account? <TextLink href="/login">Log in</TextLink>
        </p>
      </>
    );
  }
  return (
    <>
      <AuthHeading title="Create your workspace">
        Set up Docent for your team. You will teach the agent from your docs next.
      </AuthHeading>
      <SignupForm />
    </>
  );
}
