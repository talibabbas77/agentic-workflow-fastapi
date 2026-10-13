"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      illustration={<WarningCircleIcon aria-hidden="true" className="size-10 text-rust" weight="light" />}
      title="This page did not load"
      action={<Button onClick={reset}>Try again</Button>}
    >
      <p>Docent could not reach its service. Check your connection, then try again.</p>
      {error.digest ? <p className="font-mono text-sm text-ink-muted">Reference: {error.digest}</p> : null}
    </EmptyState>
  );
}
