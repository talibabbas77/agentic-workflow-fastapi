"use client";

import type { InboxDetail, InboxItem, InboxMessage } from "@docent/api-client";
import { EnvelopeSimpleIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";

type Then = "waiting" | "resolved" | "keep";

/** Reply by email. The customer gets it from the workspace's name; their answer goes to Reply-To. */
export function ReplyComposer({
  detail,
  onSent,
}: {
  detail: InboxDetail;
  onSent: (message: InboxMessage, item: InboxItem) => void;
}) {
  const form = useApiForm();
  const [body, setBody] = useState("");
  const [then, setThen] = useState<Then>("waiting");
  const contact = detail.item.contact_email;

  if (!contact) {
    return (
      <div className="flex items-start gap-3 border-t border-line px-5 py-4 text-base text-ink-muted sm:px-6">
        <EnvelopeSimpleIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" />
        <p>
          This customer did not leave an email, so a reply cannot reach them. If they write again with one, it shows up
          here and you can reply.
        </p>
      </div>
    );
  }

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!form.check({ body: !body.trim() && "Write a reply first." })) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/inbox/{escalation_id}/replies", {
            params: { path: { escalation_id: detail.item.id } },
            body: { body: body.trim(), then },
          }),
        ),
      (data) => {
        setBody("");
        onSent(data.message, data.item);
      },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <form onSubmit={send} noValidate aria-label="Reply by email" className="flex flex-col gap-3 border-t border-line px-5 py-5 sm:px-6">
      {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
      <Field
        label={
          <>
            Reply to <span className="font-normal text-ink-muted">{contact}</span>
          </>
        }
        error={form.fieldError("body")}
        hint={
          <>
            From {detail.reply_from}. Their answer goes to {detail.reply_to}.
          </>
        }
      >
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          rows={5}
          maxLength={5000}
          placeholder="Write your reply. It goes out as an email."
        />
      </Field>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-60">
          <Field label="Then">
            <Select size="sm" value={then} onChange={(event) => setThen(event.target.value as Then)}>
              <option value="waiting">Wait for the customer</option>
              <option value="resolved">Mark resolved</option>
              <option value="keep">Keep the status</option>
            </Select>
          </Field>
        </div>
        <Button
          type="submit"
          loading={form.pending}
          icon={<PaperPlaneRightIcon aria-hidden="true" className="size-4" />}
        >
          Send reply
        </Button>
      </div>
    </form>
  );
}
