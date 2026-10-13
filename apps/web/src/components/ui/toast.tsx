"use client";

import { CheckIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "error";
type Toast = { id: number; tone: Tone; title: string; description?: string };
type ToastInput = Omit<Toast, "id">;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside ToastProvider");
  return push;
}

const DURATION_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "toast pointer-events-auto flex w-full items-start gap-3 rounded-md border bg-surface px-4 py-3 sm:w-96",
              toast.tone === "error" ? "border-rust" : "border-line-strong",
            )}
          >
            {toast.tone === "error" ? (
              <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-rust" weight="bold" />
            ) : (
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-ink" weight="bold" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className={cn("text-base font-medium", toast.tone === "error" ? "text-rust" : "text-ink")}>
                {toast.title}
              </p>
              {toast.description ? <p className="text-sm text-ink-muted">{toast.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-mt-0.5 -mr-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
