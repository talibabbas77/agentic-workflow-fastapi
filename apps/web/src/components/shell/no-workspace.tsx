"use client";

import type { Me } from "@docent/api-client";
import { useState } from "react";
import { StatusPage } from "@/components/app/status-page";
import { Button } from "@/components/ui/button";
import { logOut } from "@/lib/api/browser";

export function NoWorkspace({ me }: { me: Me }) {
  const [pending, setPending] = useState(false);
  return (
    <StatusPage
      title="You are not in a workspace"
      actions={
        <Button
          variant="secondary"
          loading={pending}
          onClick={() => {
            setPending(true);
            logOut();
          }}
        >
          Log out
        </Button>
      }
    >
      <p>
        You are logged in as <span className="font-medium text-ink">{me.user.email}</span>, but this account no
        longer belongs to a workspace. You may have been removed, or the workspace was deleted. Ask a teammate to
        invite you again, then open the link in their email.
      </p>
    </StatusPage>
  );
}
