"use client";

import { CheckIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const icons = { error: WarningCircleIcon, success: CheckIcon, info: InfoIcon };

/**
 * A sentence with an icon, never color alone. Errors are rust, success and
 * information are ink. Rendered inside a live region so screen readers hear it
 * when it appears.
 */
export function FormAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "fade-in flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-base",
        tone === "error" ? "border-rust/40 bg-rust-soft text-ink" : "border-line-strong bg-surface text-ink",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4.5 shrink-0", tone === "error" ? "text-rust" : "text-ink")}
        weight={tone === "info" ? "regular" : "bold"}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
