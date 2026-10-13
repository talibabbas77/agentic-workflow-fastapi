"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export const PASSWORD_MIN = 10;

export function PasswordHint({ length }: { length: number }) {
  const ok = length >= PASSWORD_MIN;
  return (
    <span className={cn("flex items-center gap-1.5", ok ? "text-ink" : "text-ink-muted")}>
      {ok ? (
        <CheckIcon aria-hidden="true" className="size-3.5" weight="bold" />
      ) : (
        <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-line-strong" />
      )}
      At least {PASSWORD_MIN} characters
      {!ok && length > 0 ? <span>({PASSWORD_MIN - length} to go)</span> : null}
    </span>
  );
}
