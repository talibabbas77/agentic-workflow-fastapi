"use client";

import type { Me } from "@docent/api-client";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { logOut } from "./user-menu";

export function NoWorkspace({ me }: { me: Me }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-10 sm:py-8">
      <Logo className="self-start" />
      <main className="flex flex-1 items-center justify-center py-16">
        <div className="fade-in flex w-full max-w-[440px] flex-col gap-4">
          <h1 className="font-serif text-3xl text-ink">You are not in a workspace</h1>
          <p className="text-md text-ink-muted">
            You are logged in as <span className="font-medium text-ink">{me.user.email}</span>, but this
            account no longer belongs to a workspace. You may have been removed, or the workspace was
            deleted. Ask a teammate to invite you again, then open the link in their email.
          </p>
          <div className="mt-2">
            <Button
              variant="secondary"
              loading={pending}
              onClick={async () => {
                setPending(true);
                await logOut();
              }}
            >
              Log out
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
