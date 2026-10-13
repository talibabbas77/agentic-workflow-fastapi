"use client";

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * Native modal dialog. showModal() gives us the focus trap, inert background,
 * Escape to close, and top-layer stacking for free.
 */
export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
        pressedOnBackdrop.current = false;
      }}
      className={cn(
        "dialog m-auto w-[calc(100%-2rem)] max-w-md rounded-md border border-line bg-surface p-0 text-ink",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="font-serif text-xl text-ink">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-base text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-6 pt-4 pb-6", className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end", className)}>
      {children}
    </div>
  );
}
