"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** An on and off setting with its label and an optional hint. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "mt-px inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-150 disabled:opacity-55",
          checked ? "border-rust bg-rust" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-3.5 rounded-full transition-transform duration-150 ease-out",
            checked ? "translate-x-4 bg-on-rust" : "bg-ink-subtle",
          )}
        />
      </button>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="text-sm text-ink-muted">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
