import { cn } from "@/lib/cn";

/** `warn` fills it with rust, for a limit that is close or reached. Pair it with a sentence, never color alone. */
export function ProgressBar({
  value,
  max,
  label,
  warn = false,
}: {
  value: number;
  max: number;
  label: string;
  warn?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      // A count can pass its limit; the value stays in range and the text says the real numbers.
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={`${value} of ${max}`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", warn ? "bg-rust" : "bg-ink")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
