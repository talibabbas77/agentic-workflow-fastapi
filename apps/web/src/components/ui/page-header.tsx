import type { ReactNode } from "react";

export function PageHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-col gap-1.5">
      <h1 className="text-2xl text-ink sm:text-3xl">{title}</h1>
      {description ? <p className="text-md text-ink-muted">{description}</p> : null}
    </div>
  );
}
