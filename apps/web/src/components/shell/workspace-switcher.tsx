"use client";

import type { Me } from "@docent/api-client";
import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { RoleBadge } from "@/components/ui/badge";
import { PopoverMenu } from "@/components/ui/popover-menu";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/lib/format";
import { hardNavigate } from "@/lib/navigation";

function WorkspaceTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-sm font-semibold text-ink",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "W"}
    </span>
  );
}

export function WorkspaceSwitcher({ me }: { me: Me }) {
  const toast = useToast();
  const [switching, setSwitching] = useState<string | null>(null);
  const active = me.active_tenant;
  if (!active) return null;

  async function switchTo(tenantId: string, close: () => void) {
    if (tenantId === active?.id) {
      close();
      return;
    }
    setSwitching(tenantId);
    const result = await request(api.POST("/v1/auth/switch-tenant", { body: { tenant_id: tenantId } }));
    if (result.ok) return hardNavigate("/app");
    setSwitching(null);
    close();
    toast({ tone: "error", title: "Could not switch workspace", description: result.error.message });
  }

  return (
    <PopoverMenu
      label="Workspaces"
      className="w-72"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className="flex w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2 py-1.5 text-left transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
        >
          <WorkspaceTile name={active.name} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium text-ink">{active.name}</span>
            <span className="text-xs text-ink-muted">{roleLabel[active.role]}</span>
          </span>
          <CaretUpDownIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
          <span className="sr-only">Switch workspace</span>
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          <p className="px-2.5 pt-1.5 pb-2 text-xs font-medium text-ink-muted">Workspaces</p>
          <ul className="flex flex-col gap-0.5">
            {me.tenants.map((tenant) => {
              const current = tenant.id === active.id;
              return (
                <li key={tenant.id}>
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    disabled={switching !== null}
                    onClick={() => switchTo(tenant.id, close)}
                    className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-offset-0 disabled:opacity-60"
                  >
                    <WorkspaceTile name={tenant.name} className="size-6 text-xs" />
                    <span className="min-w-0 flex-1 truncate text-base text-ink">{tenant.name}</span>
                    <RoleBadge role={tenant.role} />
                    <span className="inline-flex size-4 shrink-0 items-center justify-center">
                      {switching === tenant.id ? (
                        <span className="spinner text-xs text-ink-muted" aria-hidden="true" />
                      ) : current ? (
                        <CheckIcon aria-label="Current workspace" className="size-4 text-ink" weight="bold" />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PopoverMenu>
  );
}
