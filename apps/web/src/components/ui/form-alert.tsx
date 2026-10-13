"use client";

import { CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A sentence with an icon, never color alone. Errors are rust, success is ink.
 * Rendered inside a live region so screen readers hear it when it appears.
 */
export function FormAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "fade-in flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-base",
        tone === "error" ? "border-rust/40 bg-rust-soft text-ink" : "border-line-strong bg-surface text-ink",
      )}
    >
      {tone === "error" ? (
        <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-rust" weight="bold" />
      ) : (
        <CheckIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-ink" weight="bold" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
