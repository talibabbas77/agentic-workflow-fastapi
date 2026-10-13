import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const textLinkClasses =
  "rounded-sm font-medium text-rust underline decoration-rust/30 underline-offset-[3px] transition-colors duration-150 hover:text-rust-hover hover:decoration-rust-hover";

export function TextLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return <Link className={cn(textLinkClasses, className)} {...rest} />;
}
