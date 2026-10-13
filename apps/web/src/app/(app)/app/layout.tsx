import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AppShellSkeleton } from "@/components/shell/app-shell-skeleton";
import { NoWorkspace } from "@/components/shell/no-workspace";
import { getMe } from "@/lib/api/server";

export const metadata: Metadata = {
  title: { default: "Overview", template: "%s · Docent" },
};

/**
 * The shell renders as soon as the session is known. Everything that depends
 * on the session streams in behind this boundary; the skeleton is the static shell.
 */
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <Session>{children}</Session>
    </Suspense>
  );
}

async function Session({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me.active_tenant) return <NoWorkspace me={me} />;
  return <AppShell me={me}>{children}</AppShell>;
}
