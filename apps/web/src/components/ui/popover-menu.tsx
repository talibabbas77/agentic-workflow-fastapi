"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type TriggerProps = {
  ref: React.RefObject<HTMLButtonElement | null>;
  popoverTarget: string;
  "aria-expanded": boolean;
  "aria-controls": string;
};

type PopoverMenuProps = {
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  label: string;
  className?: string;
};

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Menu built on the native popover attribute: light dismiss, Escape to close,
 * and top-layer stacking without a library. Positioned under its trigger, or
 * above it when there is no room below.
 */
export function PopoverMenu({ trigger, children, align = "start", label, className }: PopoverMenuProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = () => document.getElementById(id)?.hidePopover();

  const place = () => {
    const button = triggerRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    if (align === "end") {
      menu.style.left = "auto";
      menu.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
    } else {
      menu.style.right = "auto";
      menu.style.left = `${Math.round(rect.left)}px`;
    }
    menu.style.minWidth = `${Math.round(rect.width)}px`;
  };

  // Once open, the menu has a size: flip it above the trigger if it would run off the bottom.
  const fit = () => {
    const button = triggerRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const height = menu.offsetHeight;
    if (rect.bottom + 6 + height > window.innerHeight && rect.top - 6 - height >= 0) {
      menu.style.top = `${Math.round(rect.top - 6 - height)}px`;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? items[(index + 1) % items.length]
        : items[(index - 1 + items.length) % items.length];
    next?.focus();
  };

  return (
    <>
      {trigger({ ref: triggerRef, popoverTarget: id, "aria-expanded": open, "aria-controls": id })}
      <div
        ref={menuRef}
        id={id}
        popover="auto"
        aria-label={label}
        onBeforeToggle={(event) => {
          if (event.newState === "open") place();
        }}
        onToggle={(event) => {
          setOpen(event.newState === "open");
          if (event.newState === "open") fit();
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "menu fixed m-0 max-w-[calc(100vw-1rem)] rounded-md border border-line bg-surface p-1 text-ink",
          className,
        )}
      >
        {typeof children === "function" ? children(close) : children}
      </div>
    </>
  );
}

export function MenuItem({
  className,
  children,
  icon,
  ...rest
}: React.ComponentProps<"button"> & { icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-base text-ink transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-offset-0",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}
