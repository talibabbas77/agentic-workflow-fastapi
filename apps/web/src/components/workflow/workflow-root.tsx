"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The only client code in the workflow diagram: lets its CSS animations run only
 * while it is on screen. Everything inside is server-rendered.
 */
export function WorkflowRoot({
  label,
  loop,
  className,
  children,
}: {
  label: string;
  loop: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => el.toggleAttribute("data-playing", Boolean(entry?.isIntersecting)),
      { rootMargin: "64px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} role="group" aria-label={label} data-loop={loop || undefined} className={className}>
      {children}
    </div>
  );
}
