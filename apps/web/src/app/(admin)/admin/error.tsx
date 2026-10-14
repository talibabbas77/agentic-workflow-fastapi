"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      illustration={<WarningCircleIcon aria-hidden="true" className="size-10 text-rust" weight="light" />}
      title="The console could not load this page"
      action={<Button onClick={reset}>Try again</Button>}
    >
      {error.digest ? <p className="font-mono text-sm">Reference: {error.digest}</p> : null}
    </EmptyState>
  );
}
