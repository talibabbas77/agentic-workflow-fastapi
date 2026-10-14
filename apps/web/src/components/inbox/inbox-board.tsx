"use client";

import type { BoardColumn, HandoffStatus, InboxBoard, InboxItem } from "@docent/api-client";
import { ArrowsLeftRightIcon, CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem, PopoverMenu } from "@/components/ui/popover-menu";
import { cn } from "@/lib/cn";
import { formatCount, formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { customerLabel } from "./inbox-list";
import { PriorityBadge, statuses, UnreadDot } from "./inbox-meta";

const DRAG_TYPE = "application/x-docent-handoff";

/**
 * The inbox as four columns. Drag a card to another column, or use its
 * "Move to" menu with the keyboard; both send the same status change.
 */
export function InboxBoardView({
  board,
  onMove,
  focusId,
  onFocused,
}: {
  board: InboxBoard;
  onMove: (item: InboxItem, to: HandoffStatus, viaKeyboard: boolean) => void;
  /** After a keyboard move, focus returns to the card's menu button in its new column. */
  focusId: string | null;
  onFocused: () => void;
}) {
  const [dragging, setDragging] = useState<InboxItem | null>(null);
  const [over, setOver] = useState<HandoffStatus | null>(null);

  function drop(event: DragEvent<HTMLElement>, status: HandoffStatus) {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    const item = board.columns.flatMap((c) => c.items).find((i) => i.id === id) ?? dragging;
    setDragging(null);
    if (item && item.status !== status) onMove(item, status, false);
  }

  return (
    <div
      className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 md:grid md:snap-none md:grid-cols-2 md:overflow-visible xl:grid-cols-4"
      aria-label="Handoffs by status"
      role="group"
    >
      {board.columns.map((column) => (
        <Column
          key={column.status}
          column={column}
          highlighted={over === column.status && dragging?.status !== column.status}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setOver(column.status);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
          }}
          onDrop={(event) => drop(event, column.status)}
        >
          {column.items.map((item) => (
            <BoardCard
              key={item.id}
              item={item}
              dragging={dragging?.id === item.id}
              focus={focusId === item.id}
              onFocused={onFocused}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, item.id);
                event.dataTransfer.effectAllowed = "move";
                setDragging(item);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onMove={(to) => onMove(item, to, true)}
            />
          ))}
        </Column>
      ))}
    </div>
  );
}

function Column({
  column,
  highlighted,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  column: BoardColumn;
  highlighted: boolean;
  children: React.ReactNode;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const meta = statuses.find((s) => s.value === column.status)!;
  const headingId = `column-${column.status}`;
  const more = column.total - column.items.length;
  return (
    <section
      aria-labelledby={headingId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex w-[82vw] max-w-sm shrink-0 snap-start flex-col rounded-md border bg-surface-2/50 transition-colors duration-150 sm:w-80 md:w-auto md:max-w-none",
        highlighted ? "border-dashed border-rust bg-rust-soft/40" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          {meta.label}
        </h2>
        <span className="text-sm text-ink-muted tabular-nums">
          {formatCount(column.total)}
          <span className="sr-only"> handoffs</span>
        </span>
      </div>
      <ul aria-labelledby={headingId} className="flex min-h-24 flex-col gap-2 p-2">
        {children}
        {column.items.length === 0 ? (
          <li className="flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong px-3 py-6 text-center text-sm text-ink-muted">
            {column.status === "resolved" ? "Nothing resolved yet" : "Nothing here"}
          </li>
        ) : null}
      </ul>
      {more > 0 ? (
        <p className="border-t border-line px-3.5 py-2 text-sm text-ink-muted">
          {formatCount(more)} more in the list view
        </p>
      ) : null}
    </section>
  );
}

function BoardCard({
  item,
  dragging,
  focus,
  onFocused,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  item: InboxItem;
  dragging: boolean;
  focus: boolean;
  onFocused: () => void;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onMove: (to: HandoffStatus) => void;
}) {
  const now = useNow();
  const moveButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!focus) return;
    moveButton.current?.focus();
    onFocused();
  }, [focus, onFocused]);

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-roledescription="Draggable handoff"
      className={cn(
        "flex cursor-grab flex-col gap-2.5 rounded-md border border-line bg-surface px-3 py-3 transition-opacity duration-150 active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5">
          <UnreadDot unread={item.unread} />
        </span>
        <Link
          href={`/app/inbox/${item.id}`}
          draggable={false}
          className={cn(
            "line-clamp-3 min-w-0 rounded-sm text-base break-words text-ink hover:underline hover:underline-offset-[3px]",
            item.unread ? "font-semibold" : "font-medium",
          )}
        >
          {item.issue}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-4.5">
        <PriorityBadge priority={item.priority} />
        {item.ticket_type ? <Badge tone="neutral">{item.ticket_type.name}</Badge> : null}
        <span className="truncate text-sm text-ink-muted">{customerLabel(item)}</span>
      </div>
      <div className="flex items-end justify-between gap-2 pl-4.5">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink-muted">
          {item.assignee ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Avatar name={item.assignee.name} seed={item.assignee.id} size="sm" />
              <span className="break-words text-ink">{item.assignee.name}</span>
            </span>
          ) : (
            <span>Nobody</span>
          )}
          <time dateTime={item.created_at} className="tabular-nums whitespace-nowrap">
            {formatRelative(item.created_at, now)}
          </time>
        </span>
        <PopoverMenu
          label={`Move ${item.issue} to`}
          align="end"
          className="w-52"
          trigger={(props) => (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-1.5 h-7 shrink-0 px-2"
              icon={<ArrowsLeftRightIcon aria-hidden="true" className="size-4" />}
              {...props}
              ref={(el) => {
                props.ref.current = el;
                moveButton.current = el;
              }}
              aria-label={`Move to: ${item.issue}`}
            >
              <span aria-hidden="true">Move</span>
            </Button>
          )}
        >
          {(close) => (
            <>
              <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-ink-muted">Move to</p>
              {statuses.map((status) => (
                <MenuItem
                  key={status.value}
                  disabled={status.value === item.status}
                  aria-current={status.value === item.status ? "true" : undefined}
                  className="disabled:text-ink-muted disabled:hover:bg-transparent"
                  icon={
                    status.value === item.status ? (
                      <CheckIcon aria-hidden="true" className="size-4" weight="bold" />
                    ) : (
                      <span aria-hidden="true" className="size-4" />
                    )
                  }
                  onClick={() => {
                    close();
                    onMove(status.value);
                  }}
                >
                  {status.label}
                </MenuItem>
              ))}
            </>
          )}
        </PopoverMenu>
      </div>
    </li>
  );
}
