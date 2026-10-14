"use client";

import type { Widget } from "@docent/api-client";
import { ArrowLeftIcon, CodeIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatDate } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { InstallCard } from "./install-card";
import { SigningKeys } from "./signing-keys";
import { WidgetSettings } from "./widget-settings";
import { widgetMode } from "./widget-mode";

/** One widget: its settings, signing keys, and install snippet. */
export function WidgetDetail({ initial, canManage }: { initial: Widget; canManage: boolean }) {
  const [widget, setWidget] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const active = widget.keys.filter((key) => key.status === "active").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <Link
          href="/app/widgets"
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          Widgets
        </Link>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface">
                <CodeIcon aria-hidden="true" className="size-5 text-ink-muted" />
              </span>
              <h1 className="min-w-0 text-2xl break-words text-ink sm:text-3xl">{widget.name}</h1>
            </div>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
              <span className="font-mono text-ink">{widget.public_id}</span>
              <span>{widgetMode(widget.anonymous_enabled, active)}</span>
              <span className="tabular-nums">Created {formatDate(widget.created_at)}</span>
            </p>
          </div>
          {canManage ? (
            <Button variant="danger" size="sm" className="self-start" onClick={() => setDeleting(true)}>
              Delete widget
            </Button>
          ) : null}
        </div>
      </div>

      <WidgetSettings key={widget.updated_at} widget={widget} canManage={canManage} onSaved={setWidget} />
      <SigningKeys widget={widget} canManage={canManage} onChange={(keys) => setWidget((w) => ({ ...w, keys }))} />
      <InstallCard widget={widget} />

      {canManage ? <DeleteWidgetDialog widget={widget} open={deleting} onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

function DeleteWidgetDialog({ widget, open, onClose }: { widget: Widget; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const form = useApiForm();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${widget.name}?`}
      description="It stops loading on your sites right away, and its signing keys are deleted. This cannot be undone."
    >
      {form.formError ? (
        <DialogBody className="pt-4 pb-2">
          <FormAlert>{form.formError}</FormAlert>
        </DialogBody>
      ) : (
        <div className="h-5" />
      )}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={form.pending}
          onClick={() =>
            form.run(
              () => request(api.DELETE("/v1/widgets/{widget_id}", { params: { path: { widget_id: widget.id } } })),
              () => {
                // Close first: this page stays mounted while hidden, and an open modal would leave the list inert.
                onClose();
                toast({ tone: "success", title: "Widget deleted", description: widget.name });
                router.push("/app/widgets");
              },
            )
          }
        >
          Delete widget
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
