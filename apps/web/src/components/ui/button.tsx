import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type StyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
};

const base =
  "relative inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap select-none " +
  "transition-[color,background-color,border-color,transform] duration-150 ease-out " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55";

const variants: Record<ButtonVariant, string> = {
  primary: "border-rust bg-rust text-on-rust hover:border-rust-hover hover:bg-rust-hover",
  secondary: "border-line-strong bg-surface text-ink hover:border-ink-subtle hover:bg-surface-2",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  danger: "border-rust bg-transparent text-rust hover:bg-rust-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-base",
};

export function buttonClasses({ variant = "primary", size = "md", block, className }: StyleOptions = {}) {
  return cn(base, variants[variant], sizes[size], block && "w-full", className);
}

type ButtonProps = ComponentProps<"button"> &
  StyleOptions & {
    loading?: boolean;
    icon?: ReactNode;
  };

export function Button({
  variant,
  size,
  block,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner text-[0.875em]" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & StyleOptions & { icon?: ReactNode };

export function ButtonLink({ variant, size, block, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, block, className })} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
