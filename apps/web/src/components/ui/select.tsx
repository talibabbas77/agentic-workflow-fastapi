"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { controlClasses, controlSizes, useField } from "./field";

type SelectProps = Omit<ComponentProps<"select">, "size"> & { size?: "sm" | "md" };

/** Native select with a custom caret. */
export function Select({ className, id, size = "md", children, ...rest }: SelectProps) {
  const field = useField();
  return (
    <div className={cn("relative", className)}>
      <select
        id={id ?? field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cn(controlClasses, controlSizes[size], "cursor-pointer appearance-none pr-9")}
        {...rest}
      >
        {children}
      </select>
      <CaretDownIcon
        aria-hidden="true"
        className={cn("pointer-events-none absolute top-1/2 size-3.5 -translate-y-1/2 text-ink-muted", size === "sm" ? "right-2.5" : "right-3")}
        weight="bold"
      />
    </div>
  );
}
