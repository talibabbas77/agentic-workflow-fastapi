import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

// Deterministic tint from the two allowed fills, so a person keeps their color.
function tint(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % 2 === 0 ? "bg-rust-soft text-ink" : "bg-surface-2 text-ink";
}

export function Avatar({ name, seed, size = "md" }: { name: string; seed: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-line text-xs font-medium select-none",
        size === "sm" ? "size-6" : "size-8 tracking-wide",
        tint(seed),
      )}
    >
      {initials(name)}
    </span>
  );
}
