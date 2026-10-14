import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { AppLoader } from "@/components/brand/logo-loader";
import { getPlatformAdmin } from "@/lib/api/server";

export const metadata: Metadata = {
  title: { default: "Admin console", template: "%s · Admin console" },
  robots: { index: false, follow: false },
};

/**
 * The platform admin console, for Docent's own operators. Anyone who is not a
 * signed-in platform admin with a verified email gets the ordinary 404 page,
 * as the API answers them; the API checks every request on its own as well.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AppLoader />}>
      <Console>{children}</Console>
    </Suspense>
  );
}

async function Console({ children }: { children: ReactNode }) {
  const me = await getPlatformAdmin();
  return <AdminShell me={me}>{children}</AdminShell>;
}
