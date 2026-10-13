"use client";

import { StatusPage } from "@/components/app/status-page";
import { Button, ButtonLink } from "@/components/ui/button";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPage
      title="Something went wrong"
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/login" variant="secondary">
            Go to log in
          </ButtonLink>
        </>
      }
    >
      <p>Docent could not load this page. If it keeps happening, the service may be down for a moment.</p>
      {error.digest ? <p className="mt-3 font-mono text-sm text-ink-muted">Reference: {error.digest}</p> : null}
    </StatusPage>
  );
}
