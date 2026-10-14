"use client";

import type { SigningKey, Widget } from "@docent/api-client";
import { CheckIcon, KeyIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatDate } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { AddKeyDialog } from "./add-key-dialog";

const MAX_ACTIVE = 2;

/** The widget's public keys. Two may be active at once, so a new key can replace an old one without downtime. */
export function SigningKeys({
  widget,
  canManage,
  onChange,
}: {
  widget: Widget;
  canManage: boolean;
  onChange: (keys: SigningKey[]) => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [retiring, setRetiring] = useState<SigningKey | null>(null);
  const { keys } = widget;
  const full = keys.filter((key) => key.status === "active").length >= MAX_ACTIVE;

  return (
    <Card aria-labelledby="keys-heading">
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle id="keys-heading">Signing keys</CardTitle>
          <CardDescription>
            Your server signs each signed-in customer&apos;s token with a private key, and Docent checks it with the
            public key here. Two can be active at once, so you can switch keys without downtime.
          </CardDescription>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
            <Button
              className="self-start sm:self-auto"
              disabled={full}
              onClick={() => {
                setDialogKey((n) => n + 1);
                setAdding(true);
              }}
              icon={<PlusIcon aria-hidden="true" className="size-4" />}
            >
              Add key
            </Button>
            {full ? <p className="text-sm text-ink-muted">Retire a key to add another.</p> : null}
          </div>
        ) : null}
      </CardHeader>

      {keys.length === 0 ? (
        <div className="flex items-center gap-3 px-6 py-6 text-base text-ink-muted">
          <KeyIcon aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
          No keys yet. Add one to let signed-in customers use the widget.
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-base max-sm:block">
            <thead className="max-sm:hidden">
              <tr className="border-b border-line text-sm text-ink-muted">
                <th scope="col" className="px-6 py-2.5 font-medium">
                  Key id
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Added
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Retired
                </th>
                {canManage ? (
                  <th scope="col" className="w-28 px-6 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {keys.map((key) => (
                <tr
                  key={key.kid}
                  className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-4 max-sm:gap-y-1.5 max-sm:px-6 max-sm:py-4"
                >
                  <td className="px-6 py-3 font-mono text-ink max-sm:w-full max-sm:p-0">{key.kid}</td>
                  <td className="px-3 py-3 whitespace-nowrap max-sm:p-0">
                    {key.status === "active" ? (
                      <span className="inline-flex items-center gap-1.5 text-ink">
                        <CheckIcon aria-hidden="true" className="size-3.5" weight="bold" />
                        Active
                      </span>
                    ) : (
                      <span className="text-ink-muted">Retired</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-muted tabular-nums max-sm:p-0 max-sm:text-sm">
                    <span className="sm:hidden">Added </span>
                    {formatDate(key.created_at)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-muted tabular-nums max-sm:p-0 max-sm:text-sm">
                    {key.retired_at ? (
                      <>
                        <span className="sm:hidden">Retired </span>
                        {formatDate(key.retired_at)}
                      </>
                    ) : (
                      <span className="max-sm:hidden">Not retired</span>
                    )}
                  </td>
                  {canManage ? (
                    <td className="px-6 py-2 text-right max-sm:ml-auto max-sm:p-0">
                      {key.status === "active" ? (
                        <Button variant="ghost" size="sm" onClick={() => setRetiring(key)}>
                          Retire
                          <span className="sr-only"> {key.kid}</span>
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <>
          <AddKeyDialog
            key={dialogKey}
            widgetId={widget.id}
            open={adding}
            onClose={() => setAdding(false)}
            onAdded={(key, way) => {
              onChange([...keys, key]);
              // A generated key keeps the dialog open for the private key download.
              if (way === "upload") {
                setAdding(false);
                toast({ tone: "success", title: "Signing key added", description: key.kid });
              }
            }}
          />
          <RetireDialog
            widgetId={widget.id}
            target={retiring}
            onClose={() => setRetiring(null)}
            onRetired={(retired) => {
              setRetiring(null);
              onChange(keys.map((key) => (key.kid === retired.kid ? retired : key)));
              toast({ tone: "success", title: "Key retired", description: retired.kid });
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

function RetireDialog({
  widgetId,
  target,
  onClose,
  onRetired,
}: {
  widgetId: string;
  target: SigningKey | null;
  onClose: () => void;
  onRetired: (key: SigningKey) => void;
}) {
  const form = useApiForm();
  // Keep the last target so the text does not vanish while the dialog fades out.
  const [last, setLast] = useState(target);
  if (target && target !== last) setLast(target);
  const shown = target ?? last;

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={`Retire ${shown?.kid ?? "key"}?`}
      description="Docent stops accepting tokens signed with this key right away. A retired key cannot be turned back on."
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
          onClick={() => {
            if (!shown) return;
            void form.run(
              () =>
                request(
                  api.POST("/v1/widgets/{widget_id}/keys/{kid}/retire", {
                    params: { path: { widget_id: widgetId, kid: shown.kid } },
                  }),
                ),
              onRetired,
            );
          }}
        >
          Retire key
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
