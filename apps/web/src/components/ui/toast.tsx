"use client";

import { CheckIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

type Tone = "success" | "error";
type Toast = { id: number; tone: Tone; title: string; description?: string };
type ToastInput = Omit<Toast, "id">;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside ToastProvider");
  return push;
}

/** How long a success toast stays. Errors stay until dismissed. */
const SUCCESS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-2), { ...toast, id }]);
  }, []);

  return (
    <ToastContext value={push}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(SUCCESS_MS);
  const paused = hovered || focused;
  const error = toast.tone === "error";

  // The countdown stops while the pointer or focus is on the toast, and resumes where it left off.
  useEffect(() => {
    if (error || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [error, paused, onDismiss, toast.id]);

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className={cn(
        "toast pointer-events-auto flex w-full items-start gap-3 rounded-md border bg-surface px-4 py-3 sm:w-96",
        error ? "border-rust" : "border-line-strong",
      )}
    >
      {error ? (
        <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-rust" weight="bold" />
      ) : (
        <CheckIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-ink" weight="bold" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn("text-base font-medium", error ? "text-rust" : "text-ink")}>{toast.title}</p>
        {toast.description ? <p className="text-sm text-ink-muted">{toast.description}</p> : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-my-2 -mr-2.5 shrink-0"
      >
        <XIcon aria-hidden="true" className="size-4.5" />
      </Button>
    </div>
  );
}
