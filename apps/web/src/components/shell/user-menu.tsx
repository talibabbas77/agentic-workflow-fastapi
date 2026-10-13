"use client";

import type { Me } from "@docent/api-client";
import { SignOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { api } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { hardNavigate } from "@/lib/navigation";

export async function logOut() {
  await settle(api.POST("/v1/auth/logout"));
  hardNavigate("/login");
}

export function UserMenu({ me }: { me: Me }) {
  const [pending, setPending] = useState(false);
  return (
    <PopoverMenu
      label="Account"
      align="end"
      className="w-64"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Account menu for ${me.user.name}`}
          className="inline-flex items-center rounded-full transition-opacity duration-150 hover:opacity-85"
        >
          <Avatar name={me.user.name} seed={me.user.id} />
        </button>
      )}
    >
      <div className="flex flex-col gap-0.5 px-2.5 pt-2 pb-2.5">
        <p className="truncate text-base font-medium text-ink">{me.user.name}</p>
        <p className="truncate text-sm text-ink-muted">{me.user.email}</p>
      </div>
      <MenuSeparator />
      <MenuItem
        disabled={pending}
        icon={<SignOutIcon aria-hidden="true" className="size-4 text-ink-muted" />}
        onClick={async () => {
          setPending(true);
          await logOut();
        }}
      >
        {pending ? "Logging out" : "Log out"}
      </MenuItem>
    </PopoverMenu>
  );
}
