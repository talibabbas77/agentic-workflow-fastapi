"use client";

import type { CustomerFact, RememberedCustomer, RememberedCustomerDetail } from "@docent/api-client";
import { InfoIcon, TrashIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatCount, formatDate, formatRelative, plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { factKinds } from "./memory-meta";
import { PanelEmpty, PanelIntro } from "./panel";

const customerName = (customer: RememberedCustomer) => customer.name || customer.email || "Signed-in customer";

/** What the agent remembers about each signed-in customer, and the way to make it forget. */
export function CustomerMemory({
  customers,
  canManage,
  onChanged,
}: {
  customers: RememberedCustomer[];
  canManage: boolean;
  /** Something was forgotten: reload the list and the totals. */
  onChanged: () => void;
}) {
  const now = useNow();
  const [open, setOpen] = useState<RememberedCustomer | null>(null);
  // A new key per opening gives the dialog fresh state each time.
  const [dialogKey, setDialogKey] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <PanelIntro>
        After a signed-in customer&apos;s conversation goes quiet, the agent writes down up to five short facts, such as
        their setup or an issue that is still open. It reads them the next time that customer asks, to understand the
        situation.
      </PanelIntro>
      <p className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        <span>
          Only customers signed in through your token are remembered, never anonymous visitors. Each fact is kept for 90
          days. Memory is never used as a source: answers still come only from your sources and team answers.
        </span>
      </p>

      {customers.length === 0 ? (
        <PanelEmpty
          icon={<UserCircleIcon aria-hidden="true" className="size-6" weight="light" />}
          title="No customers remembered yet"
        >
          Memory starts when signed-in customers chat through a widget. About 15 minutes after a conversation ends, the
          facts worth keeping show up here.
        </PanelEmpty>
      ) : (
        <Card aria-label="Remembered customers">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-base max-md:block">
              <thead className="max-md:hidden">
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th scope="col" className="px-6 py-2.5 font-medium">
                    Customer
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Facts
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Conversations
                  </th>
                  <th scope="col" className="px-6 py-2.5 font-medium">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="border-b border-line align-middle transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4 max-md:gap-y-2 max-md:py-4 max-md:pr-6 max-md:pl-[4.25rem]"
                  >
                    <td className="px-6 py-3 max-md:-ml-11 max-md:w-[calc(100%+2.75rem)] max-md:p-0">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={customerName(customer)} seed={customer.id} />
                        <div className="flex min-w-0 flex-col">
                          <button
                            type="button"
                            onClick={() => {
                              setDialogKey((n) => n + 1);
                              setOpen(customer);
                            }}
                            className="truncate rounded-sm text-left font-medium text-ink underline-offset-[3px] hover:underline"
                          >
                            {customerName(customer)}
                          </button>
                          {customer.name && customer.email ? (
                            <span className="truncate text-sm text-ink-muted">{customer.email}</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums max-md:p-0 max-md:text-sm max-md:text-ink-muted">
                      {formatCount(customer.facts)}
                      <span className="md:hidden"> {plural(customer.facts, "fact")}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                      {formatCount(customer.conversations)}
                      <span className="md:hidden"> {plural(customer.conversations, "conversation")}</span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-ink-muted max-md:p-0 max-md:text-sm">
                      <span className="md:hidden">Seen </span>
                      {customer.last_seen_at ? formatRelative(customer.last_seen_at, now) : "Not yet"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CustomerDialog
        key={dialogKey}
        customer={open}
        canManage={canManage}
        onClose={() => setOpen(null)}
        onChanged={onChanged}
      />
    </div>
  );
}

function CustomerDialog({
  customer,
  canManage,
  onClose,
  onChanged,
}: {
  customer: RememberedCustomer | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const form = useApiForm();
  const [detail, setDetail] = useState<RememberedCustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Keep the last customer so the text does not vanish while the dialog fades out.
  const [last, setLast] = useState(customer);
  if (customer && customer !== last) setLast(customer);
  const shown = customer ?? last;
  const id = customer?.id;

  useEffect(() => {
    if (!id) return;
    let live = true;
    void request(api.GET("/v1/memory/customers/{end_user_id}", { params: { path: { end_user_id: id } } })).then(
      (result) => {
        if (!live) return;
        if (result.ok) setDetail(result.data);
        else setLoadError(result.error.message);
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  async function forgetFact(fact: CustomerFact) {
    if (!id) return;
    setForgetting(fact.id);
    const result = await request(
      api.DELETE("/v1/memory/customers/{end_user_id}/facts/{fact_id}", {
        params: { path: { end_user_id: id, fact_id: fact.id } },
      }),
    );
    setForgetting(null);
    if (!result.ok) {
      toast({ tone: "error", title: "Could not forget that fact", description: result.error.message });
      return;
    }
    const facts = detail?.facts.filter((f) => f.id !== fact.id) ?? [];
    setDetail((d) => (d ? { ...d, facts } : d));
    toast({ tone: "success", title: "Fact forgotten" });
    onChanged();
    if (facts.length === 0) onClose();
  }

  const name = shown ? customerName(shown) : "this customer";

  return (
    <Dialog
      open={customer !== null}
      onClose={onClose}
      size="lg"
      title={name}
      description={
        shown?.name && shown.email
          ? `${shown.email}. What the agent remembers from earlier conversations.`
          : "What the agent remembers from earlier conversations."
      }
    >
      <DialogBody className="flex flex-col gap-6">
        {loadError ? (
          <FormAlert>{loadError}</FormAlert>
        ) : !detail ? (
          <Loading label="Loading what the agent remembers" className="flex flex-col gap-5">
            {[3, 2].map((rows, group) => (
              <div key={group} className="flex flex-col gap-2.5">
                <Skeleton className="h-4 w-28" />
                {Array.from({ length: rows }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ))}
          </Loading>
        ) : (
          factKinds.map(({ kind, label }) => {
            const facts = detail.facts.filter((fact) => fact.kind === kind);
            if (facts.length === 0) return null;
            return (
              <section key={kind} aria-label={label} className="fade-in flex flex-col gap-2">
                <h3 className="text-sm font-medium text-ink-muted">{label}</h3>
                <ul className="flex flex-col gap-2">
                  {facts.map((fact) => (
                    <li
                      key={fact.id}
                      className="flex flex-col gap-2 rounded-md border border-line bg-paper px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <p dir="auto" className="break-words text-ink">
                          {fact.fact}
                        </p>
                        <p className="text-xs text-ink-muted">
                          Remembered {formatDate(fact.created_at)}. Kept until {formatDate(fact.expires_at)}.
                        </p>
                      </div>
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-3 shrink-0 self-start sm:-mr-1.5 sm:ml-0"
                          loading={forgetting === fact.id}
                          disabled={forgetting !== null && forgetting !== fact.id}
                          onClick={() => void forgetFact(fact)}
                          icon={<TrashIcon aria-hidden="true" className="size-4" />}
                        >
                          Forget this fact
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
        {confirming ? (
          <FormAlert>
            The agent forgets every fact about {name} right away. Their conversations stay in the inbox. This cannot be
            undone.
          </FormAlert>
        ) : null}
        {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
      </DialogBody>
      <DialogFooter>
        {canManage && detail ? (
          confirming ? (
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Keep memory
              </Button>
              <Button
                variant="danger"
                loading={form.pending}
                onClick={() => {
                  if (!id) return;
                  void form.run(
                    () =>
                      request(api.DELETE("/v1/memory/customers/{end_user_id}", { params: { path: { end_user_id: id } } })),
                    () => {
                      toast({ tone: "success", title: "Customer forgotten", description: name });
                      onChanged();
                      onClose();
                    },
                  );
                }}
              >
                Forget customer
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Forget this customer
              </Button>
            </>
          )
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
