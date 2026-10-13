import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: ComponentProps<"section">) {
  return <section className={cn("rounded-md border border-line bg-surface", className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 border-b border-line px-6 py-5", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: ComponentProps<"h2">) {
  return <h2 className={cn("font-serif text-lg text-ink", className)} {...rest} />;
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
