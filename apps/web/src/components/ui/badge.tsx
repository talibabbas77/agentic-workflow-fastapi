import type { Role } from "@docent/api-client";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/lib/format";

type Tone = "neutral" | "accent" | "outline";

const tones: Record<Tone, string> = {
  neutral: "border-transparent bg-surface-2 text-ink",
  accent: "border-transparent bg-rust-soft text-ink",
  outline: "border-line-strong bg-transparent text-ink-muted",
};

export function Badge({ tone = "neutral", className, ...rest }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}

const roleTone: Record<Role, Tone> = { owner: "accent", admin: "neutral", agent: "outline" };

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <Badge tone={roleTone[role]} className={className}>
      {roleLabel[role]}
    </Badge>
  );
}
