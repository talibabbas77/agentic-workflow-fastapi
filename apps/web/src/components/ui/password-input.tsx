"use client";

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Input } from "./field";

export function PasswordInput({ className, ...rest }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-11", className)} {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-1 right-1 inline-flex w-9 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
      >
        {visible ? (
          <EyeSlashIcon aria-hidden="true" className="size-4.5" />
        ) : (
          <EyeIcon aria-hidden="true" className="size-4.5" />
        )}
      </button>
    </div>
  );
}
