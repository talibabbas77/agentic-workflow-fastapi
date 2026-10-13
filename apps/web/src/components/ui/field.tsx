"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type FieldState = { id: string; describedBy?: string; invalid: boolean };

const FieldContext = createContext<FieldState | null>(null);

/** Wires a control to its label, hint, and error. Controls read this automatically. */
export function useField() {
  return useContext(FieldContext);
}

export function Label({ className, ...rest }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-ink", className)} {...rest} />;
}

type FieldProps = {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Extra content on the label row, such as a "Forgot password?" link. */
  aside?: ReactNode;
  id?: string;
  className?: string;
};

export function Field({ label, children, hint, error, aside, id, className }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = `${controlId}-error`;
  const describedBy = [error ? errorId : undefined, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={controlId}>{label}</Label>
          {aside}
        </div>
        {children}
        {hint ? (
          <div id={hintId} className="text-sm text-ink-muted">
            {hint}
          </div>
        ) : null}
        <div id={errorId} aria-live="polite">
          {error ? <FieldError>{error}</FieldError> : null}
        </div>
      </div>
    </FieldContext>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-rust">
      <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
      <span>{children}</span>
    </p>
  );
}

/** Shared look for inputs and selects. Size classes are separate so they never conflict. */
export const controlClasses =
  "w-full rounded-md border border-line-strong bg-surface text-ink " +
  "placeholder:text-ink-subtle transition-colors duration-150 hover:border-ink-subtle " +
  "aria-invalid:border-rust disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted";

// 16px text on small screens stops iOS Safari from zooming into the field.
export const controlSizes = {
  md: "h-10 px-3 text-md sm:text-base",
  sm: "h-8 px-2.5 text-sm",
} as const;

const readOnlyClasses = "read-only:bg-surface-2 read-only:text-ink-muted read-only:hover:border-line-strong";

export function Input({ className, id, ...rest }: ComponentProps<"input">) {
  const field = useField();
  return (
    <input
      id={id ?? field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cn(controlClasses, controlSizes.md, readOnlyClasses, className)}
      {...rest}
    />
  );
}
