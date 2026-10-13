import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingJourney } from "@/components/app/onboarding-journey";
import { VerifyBanner } from "@/components/app/verify-banner";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AnswerFlow } from "@/components/workflow/answer-flow";
import { IdentityFlow } from "@/components/workflow/identity-flow";
import { getOnboarding } from "@/lib/api/data";
import { getMe } from "@/lib/api/server";
import { firstName } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const [me, onboarding] = await Promise.all([getMe(), getOnboarding()]);
  const total = onboarding.steps.length;
  const workspace = me.active_tenant;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`Welcome, ${firstName(me.user.name)}`}
        description={
          onboarding.completed === total
            ? `${workspace?.name ?? "Your workspace"} is set up.`
            : `Here is what is left to set up in ${workspace?.name ?? "your workspace"}.`
        }
      />

      {me.user.email_verified ? null : <VerifyBanner email={me.user.email} />}

      <Card aria-labelledby="setup-heading">
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle id="setup-heading">Get Docent ready</CardTitle>
            <CardDescription>Each step unlocks the next. Teach the agent before it answers anyone.</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-48">
            <p className="text-sm text-ink-muted sm:text-right">
              <span className="font-display text-lg font-semibold text-ink tabular">{onboarding.completed}</span> of {total} done
            </p>
            <ProgressBar value={onboarding.completed} max={total} label="Setup progress" />
          </div>
        </CardHeader>
        <CardBody className="py-8 sm:px-8">
          <OnboardingJourney onboarding={onboarding} role={workspace?.role ?? "agent"} />
        </CardBody>
      </Card>

      <section aria-labelledby="how-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="how-heading" className="font-display text-xl text-ink">
            How Docent works
          </h2>
          <p className="text-sm text-ink-muted">
            What happens once the agent is taught and the widget is on your site.
          </p>
        </div>
        <Card aria-labelledby="answer-flow-heading">
          <CardHeader>
            <CardTitle id="answer-flow-heading">How Docent answers</CardTitle>
            <CardDescription>
              Every answer cites the page it came from. When no source supports an answer, a person
              takes over.
            </CardDescription>
          </CardHeader>
          <CardBody className="py-8 sm:px-8">
            <AnswerFlow />
          </CardBody>
        </Card>
        <Card aria-labelledby="identity-flow-heading">
          <CardHeader>
            <CardTitle id="identity-flow-heading">How Docent knows who is asking</CardTitle>
            <CardDescription>
              Your server vouches for the logged-in user. Docent never reads your cookies and never
              trusts a name typed into the chat.
            </CardDescription>
          </CardHeader>
          <CardBody className="py-8 sm:px-8">
            <IdentityFlow />
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
