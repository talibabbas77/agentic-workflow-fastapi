import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: ComponentProps<"section">) {
  return <section className={cn("rounded-md border border-line bg-surface", className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 border-b border-line px-6 py-5", className)} {...rest} />;
}

/** A card's heading. Use `as="h3"` when the card sits inside a section that has its own h2. */
export function CardTitle({ as: Heading = "h2", className, ...rest }: ComponentProps<"h2"> & { as?: "h2" | "h3" }) {
  return <Heading className={cn("text-lg text-ink", className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cn("text-base text-ink-muted", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("px-6 py-5", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-end gap-3 border-t border-line px-6 py-4", className)}
      {...rest}
    />
  );
}
