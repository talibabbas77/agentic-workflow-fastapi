import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

type StyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap select-none " +
  "transition-[color,background-color,border-color,transform] duration-150 ease-out " +
  "active:translate-y-px disabled:opacity-55 aria-disabled:opacity-55";

const variants: Record<ButtonVariant, string> = {
  primary: "border-rust bg-rust text-on-rust hover:border-rust-hover hover:bg-rust-hover",
  secondary: "border-line-strong bg-surface text-ink hover:border-ink-subtle hover:bg-surface-2",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  danger: "border-rust bg-transparent text-rust hover:bg-rust-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-base",
  // Square, for a single icon. Callers give it an aria-label and a size-4.5 icon.
  icon: "size-9",
};

function buttonClasses({ variant = "primary", size = "md", block, className }: StyleOptions) {
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

export function ButtonLink({ variant, size, block, className, ...rest }: ComponentProps<typeof Link> & StyleOptions) {
  return <Link className={buttonClasses({ variant, size, block, className })} {...rest} />;
}
