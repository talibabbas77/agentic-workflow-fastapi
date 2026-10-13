import { Suspense, type ReactNode } from "react";
import { AppLoader } from "@/components/brand/logo-loader";
import { AppShell } from "@/components/shell/app-shell";
import { NoWorkspace } from "@/components/shell/no-workspace";
import { getMe } from "@/lib/api/server";

/**
 * The shell renders as soon as the session is known. Until then there is no
 * layout to sketch, so the branded loader holds the screen.
 */
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<AppLoader />}>
      <Session>{children}</Session>
    </Suspense>
  );
}

async function Session({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me.active_tenant) return <NoWorkspace me={me} />;
  return <AppShell me={me}>{children}</AppShell>;
}
