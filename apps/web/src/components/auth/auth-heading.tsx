import type { ReactNode } from "react";

export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-2">
      <h1 className="font-serif text-3xl text-ink">{title}</h1>
      {children ? <p className="text-md text-ink-muted">{children}</p> : null}
    </div>
  );
}
