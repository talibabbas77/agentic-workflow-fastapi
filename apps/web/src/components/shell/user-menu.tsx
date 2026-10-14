"use client";

import type { Me } from "@docent/api-client";
import { ArrowLeftIcon, ShieldCheckIcon, SignOutIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { MenuItem, MenuLink, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { logOut } from "@/lib/api/browser";

/**
 * The account menu in the top bar. In the app, platform admins also get a way
 * into the console at /admin; everyone else never sees it. In the console, it
 * leads back to the app instead.
 */
export function UserMenu({ me, place = "app" }: { me: Me; place?: "app" | "console" }) {
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
      {place === "console" ? (
        <MenuLink href="/app" icon={<ArrowLeftIcon aria-hidden="true" className="size-4 text-ink-muted" />}>
          Back to the app
        </MenuLink>
      ) : me.platform_admin ? (
        <MenuLink href="/admin" icon={<ShieldCheckIcon aria-hidden="true" className="size-4 text-ink-muted" />}>
          Platform admin
        </MenuLink>
      ) : null}
      <MenuItem
        disabled={pending}
        icon={<SignOutIcon aria-hidden="true" className="size-4 text-ink-muted" />}
        onClick={() => {
          setPending(true);
          logOut();
        }}
      >
        {pending ? "Logging out" : "Log out"}
      </MenuItem>
    </PopoverMenu>
  );
}
