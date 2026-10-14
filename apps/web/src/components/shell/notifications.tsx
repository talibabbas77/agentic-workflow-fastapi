"use client";

import type { AppNotification, AppNotifications } from "@docent/api-client";
import { BellIcon, CheckIcon, TrayIcon, UserCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MenuLink, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { usePoll } from "@/lib/use-poll";

/** Often enough to notice new work, rare enough to leave a small database alone. */
const POLL_MS = 30_000;

type NotificationsState = {
  data: AppNotifications | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** The inbox list knows the unread count first; it reports it here. */
  setInboxUnread: (count: number) => void;
};

const Context = createContext<NotificationsState | null>(null);

const noop: NotificationsState = {
  data: null,
  refresh: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
  setInboxUnread: () => {},
};

/** The member's notifications and unread handoffs, for the whole app shell. */
export function useNotifications(): NotificationsState {
  return useContext(Context) ?? noop;
}

/**
 * Polls /v1/notifications every 30 seconds while the tab is visible, and on
 * every page change. Feeds the Inbox badge in the sidebar and the bell in the
 * top bar.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [data, setData] = useState<AppNotifications | null>(null);

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/notifications"));
    if (result.ok) setData(result.data);
  }, []);

  // On the first render and every page change, then on the poll.
  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await request(api.GET("/v1/notifications"));
      if (live && result.ok) setData(result.data);
    })();
    return () => {
      live = false;
    };
  }, [pathname]);
  usePoll(true, refresh, POLL_MS);

  const markRead = useCallback(
    async (id: string) => {
      setData((d) =>
        d
          ? {
              ...d,
              unread: Math.max(0, d.unread - (d.items.some((n) => n.id === id && !n.read_at) ? 1 : 0)),
              items: d.items.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
            }
          : d,
      );
      await request(api.POST("/v1/notifications/{notification_id}/read", { params: { path: { notification_id: id } } }));
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    const at = new Date().toISOString();
    setData((d) => (d ? { ...d, unread: 0, items: d.items.map((n) => ({ ...n, read_at: n.read_at ?? at })) } : d));
    await request(api.POST("/v1/notifications/read"));
    await refresh();
  }, [refresh]);

  const setInboxUnread = useCallback((count: number) => {
    setData((d) => (d && d.inbox_unread !== count ? { ...d, inbox_unread: count } : d));
  }, []);

  const value = useMemo(
    () => ({ data, refresh, markRead, markAllRead, setInboxUnread }),
    [data, refresh, markRead, markAllRead, setInboxUnread],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The unread handoff count beside Inbox in the sidebar. Visible text, never color alone. */
export function InboxBadge() {
  const count = useNotifications().data?.inbox_unread ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1.5 text-xs font-semibold text-on-rust tabular-nums">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

const kindLabel: Record<AppNotification["kind"], string> = {
  new_handoff: "New handoff",
  assigned: "Assigned to you",
};

/** The bell in the top bar: the member's latest notifications, each linking to its handoff. */
export function NotificationsBell() {
  const { data, refresh, markRead, markAllRead } = useNotifications();
  const now = useNow();
  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  return (
    <PopoverMenu
      label="Notifications"
      align="end"
      className="w-[min(22rem,calc(100vw-1rem))] p-0"
      trigger={(props) => (
        <Button
          variant="ghost"
          size="icon"
          {...props}
          onClick={() => void refresh()}
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative"
        >
          <BellIcon aria-hidden="true" className="size-4.5" weight={unread ? "fill" : "regular"} />
          {unread ? (
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[0.625rem] leading-none font-semibold text-on-rust tabular-nums"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2.5">
            <p className="text-base font-semibold tracking-tight text-ink">Notifications</p>
            <button
              type="button"
              disabled={unread === 0}
              onClick={() => void markAllRead()}
              className="rounded-sm text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink disabled:text-ink-subtle disabled:hover:text-ink-subtle"
            >
              Mark all as read
            </button>
          </div>
          <MenuSeparator />
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">
              Nothing yet. New handoffs routed to you and handoffs assigned to you show up here.
            </p>
          ) : (
            <ul aria-label="Latest notifications" className="flex max-h-[min(24rem,60vh)] flex-col overflow-y-auto p-1">
              {items.map((n) => {
                const Icon = n.kind === "assigned" ? UserCircleIcon : TrayIcon;
                return (
                  <li key={n.id} className="flex items-start gap-1">
                    <Link
                      href={`/app/inbox/${n.escalation_id}`}
                      onClick={() => {
                        if (!n.read_at) void markRead(n.id);
                        close();
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-sm px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-offset-0"
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn("mt-0.5 size-4 shrink-0", n.read_at ? "text-ink-subtle" : "text-rust")}
                        weight={n.read_at ? "regular" : "fill"}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className={cn("text-sm text-ink", !n.read_at && "font-semibold")}>
                          {kindLabel[n.kind]}
                          {n.read_at ? null : <span className="sr-only">, unread</span>}
                        </span>
                        <span dir="auto" className="line-clamp-2 text-sm break-words text-ink">
                          {n.issue}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {n.detail ? `${n.detail}, ` : ""}
                          {formatRelative(n.created_at, now)}
                        </span>
                      </span>
                    </Link>
                    {n.read_at ? null : (
                      <button
                        type="button"
                        aria-label={`Mark as read: ${kindLabel[n.kind]}`}
                        title="Mark as read"
                        onClick={() => void markRead(n.id)}
                        className="mt-2 mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                      >
                        <CheckIcon aria-hidden="true" className="size-4" weight="bold" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <MenuSeparator />
          <div className="p-1">
            <MenuLink
              href="/app/inbox"
              onClick={close}
              icon={<TrayIcon aria-hidden="true" className="size-4 text-ink-muted" />}
            >
              Open the inbox
              {data?.inbox_unread ? (
                <span className="ml-auto text-sm text-ink-muted tabular-nums">{data.inbox_unread} unread</span>
              ) : null}
            </MenuLink>
          </div>
        </>
      )}
    </PopoverMenu>
  );
}
