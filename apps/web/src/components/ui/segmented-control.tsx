"use client";

import { cn } from "@/lib/cn";

type Option<T extends string> = { value: T; label: string };

/** A few exclusive options in one row, built on native radios so arrow keys and forms just work. */
export function SegmentedControl<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-ink">{legend}</legend>
      <div
        className={cn(
          "inline-flex max-w-full self-start rounded-md border border-line-strong bg-surface-2 p-0.5",
          disabled && "opacity-60",
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "relative cursor-pointer rounded-sm px-3 py-1.5 text-center text-sm transition-colors duration-150 has-disabled:cursor-not-allowed has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-rust",
              value === option.value
                ? "bg-surface font-medium text-ink"
                : "text-ink-muted hover:text-ink has-disabled:hover:text-ink-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
    </fieldset>
  );
}
