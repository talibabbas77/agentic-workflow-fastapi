import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

// Deterministic tint from the two allowed fills, so a person keeps their color.
function tint(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % 2 === 0 ? "bg-rust-soft text-ink" : "bg-surface-2 text-ink";
}

export function Avatar({
  name,
  seed,
  size = "md",
  className,
}: {
  name: string;
  seed?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-line font-medium tracking-wide select-none",
        size === "sm" ? "size-7 text-xs" : "size-8 text-xs",
        tint(seed ?? name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
