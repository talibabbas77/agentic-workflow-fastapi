"use client";

import type { Source } from "@docent/api-client";
import { ArrowClockwiseIcon, DotsThreeIcon, TrashIcon, UsersIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";
import { AudienceField, readAudience } from "./audience-field";

type SourceActionsProps = {
  source: Source;
  /** A menu for table rows, plain buttons for the detail page. */
  layout: "menu" | "buttons";
  /** Called after any change so the caller can load fresh data. */
  onChanged: () => void;
  /** Called instead of `onChanged` once a delete is accepted, for pages that should leave. */
  onDeleted?: () => void;
};

export function SourceActions({ source, layout, onChanged, onDeleted = onChanged }: SourceActionsProps) {
  const toast = useToast();
  const [dialog, setDialog] = useState<"audience" | "delete" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const deleting = source.status === "deleting";

  async function resync() {
    setSyncing(true);
    const result = await request(
      api.POST("/v1/knowledge/sources/{source_id}/sync", { params: { path: { source_id: source.id } } }),
    );
    setSyncing(false);
    if (result.ok) {
      toast({ tone: "success", title: "Re-sync started", description: source.title });
      onChanged();
    } else {
      toast({ tone: "error", title: "Could not re-sync", description: result.error.message });
    }
  }

  const dialogs = (
    <>
      <AudienceDialog
        source={source}
        open={dialog === "audience"}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          toast({ tone: "success", title: "Audience changed", description: source.title });
          onChanged();
        }}
      />
      <DeleteDialog
        source={source}
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onDeleted={() => {
          setDialog(null);
          toast({ tone: "success", title: "Deleting source", description: source.title });
          onDeleted();
        }}
      />
    </>
  );

  if (layout === "buttons") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={syncing}
          disabled={deleting}
          onClick={resync}
          icon={<ArrowClockwiseIcon aria-hidden="true" className="size-4" />}
        >
          Re-sync
        </Button>
        <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setDialog("audience")}>
          Change audience
        </Button>
        <Button variant="danger" size="sm" disabled={deleting} onClick={() => setDialog("delete")}>
          Delete
        </Button>
        {dialogs}
      </div>
    );
  }

  return (
    <>
      <PopoverMenu
        label={`Actions for ${source.title}`}
        align="end"
        className="w-52"
        trigger={(props) => (
          <Button
            variant="ghost"
            size="icon"
            {...props}
            aria-label={`Actions for ${source.title}`}
            disabled={deleting}
            loading={syncing}
          >
            {syncing ? null : <DotsThreeIcon aria-hidden="true" className="size-4.5" weight="bold" />}
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<ArrowClockwiseIcon aria-hidden="true" className="size-4 text-ink-muted" />}
              onClick={() => {
                close();
                resync();
              }}
            >
              Re-sync
            </MenuItem>
            <MenuItem
              icon={<UsersIcon aria-hidden="true" className="size-4 text-ink-muted" />}
              onClick={() => {
                close();
                setDialog("audience");
              }}
            >
              Change audience
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              className="text-rust"
              icon={<TrashIcon aria-hidden="true" className="size-4" />}
              onClick={() => {
                close();
                setDialog("delete");
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </PopoverMenu>
      {dialogs}
    </>
  );
}

function AudienceDialog({
  source,
  open,
  onClose,
  onSaved,
}: {
  source: Source;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useApiForm();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const audience = readAudience(new FormData(event.currentTarget));
    await form.run(
      () =>
        request(
          api.PATCH("/v1/knowledge/sources/{source_id}", {
            params: { path: { source_id: source.id } },
            body: { audience },
          }),
        ),
      onSaved,
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change audience"
      description={`Choose who the agent may answer for from ${source.title}.`}
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <AudienceField key={source.audience} defaultValue={source.audience} error={form.fieldError("audience")} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  source,
  open,
  onClose,
  onDeleted,
}: {
  source: Source;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const form = useApiForm();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${source.title}?`}
      description="The agent stops answering from it right away. Its documents and passages are removed, and this cannot be undone."
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
              () =>
                request(api.DELETE("/v1/knowledge/sources/{source_id}", { params: { path: { source_id: source.id } } })),
              onDeleted,
            )
          }
        >
          Delete source
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
