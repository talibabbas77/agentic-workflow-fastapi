import { CopyButton } from "./copy-button";

/** Server-rendered code with a small copy button island. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex h-11 items-center justify-between border-b border-line px-4">
        <span className="text-sm text-ink-muted">{label}</span>
        <CopyButton text={code} label={label} />
      </div>
      {/* Long lines scroll sideways; tabIndex lets keyboard users scroll them too. */}
      <pre
        tabIndex={0}
        role="region"
        aria-label={`${label} code`}
        className="overflow-x-auto px-4 py-4 font-mono text-sm leading-relaxed text-ink"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
