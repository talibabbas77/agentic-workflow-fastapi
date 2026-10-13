import type { ReactNode } from "react";

/**
 * Wraps any loading placeholder (skeleton blocks, a spinner, the logo loader)
 * so screen readers hear one short status instead of empty shapes.
 */
export function Loading({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
