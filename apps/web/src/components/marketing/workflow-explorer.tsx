"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ExplorerStep = {
  id: string;
  title: string;
  sub: string;
  icon: ReactNode;
  panel: ReactNode;
};

/**
 * Tabs over server-rendered panels. Only the visible panel's diagram animates,
 * because each diagram pauses itself while it is not on screen. Without
 * script, a noscript style hides the tabs and shows every panel in order.
 */
export function WorkflowExplorer({ label, steps }: { label: string; steps: ExplorerStep[] }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % steps.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + steps.length) % steps.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = steps.length - 1;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <noscript
        dangerouslySetInnerHTML={{
          __html: "<style>.mk-tablist{display:none!important}.mk-tab-inactive{display:block!important}</style>",
        }}
      />
      <div role="tablist" aria-label={label} className="mk-tablist grid grid-cols-2 gap-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const selected = active === index;
          return (
            <button
              key={step.id}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "group relative flex min-w-0 flex-col items-start gap-1 rounded-lg border px-4 py-3.5 text-left transition-colors duration-150",
                selected
                  ? "border-ink bg-surface"
                  : "border-line bg-transparent hover:border-line-strong hover:bg-surface",
              )}
            >
              {selected ? <span aria-hidden="true" className="mk-ribbon absolute -top-px right-4 h-5 w-2.5" /> : null}
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-lg transition-colors duration-150",
                    selected ? "text-rust" : "text-ink-muted group-hover:text-ink",
                  )}
                >
                  {step.icon}
                </span>
                <span className="text-xs font-medium text-ink-muted tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </span>
              <span className={cn("text-md font-medium", selected ? "text-ink" : "text-ink-muted group-hover:text-ink")}>
                {step.title}
              </span>
              <span className="text-sm text-ink-muted">{step.sub}</span>
            </button>
          );
        })}
      </div>
      {steps.map((step, index) => (
        <div
          key={step.id}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          className={active === index ? undefined : "mk-tab-inactive"}
        >
          {step.panel}
        </div>
      ))}
    </div>
  );
}
