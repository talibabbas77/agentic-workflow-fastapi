"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** The widget's own check, so the preview accepts and refuses the same addresses. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The form an anonymous visitor sees under a handoff in the widget. In the
 * preview it sends the email as the next visitor message, which the agent
 * stores on the handoff and confirms, exactly as when a visitor types it.
 * `busy` while any message is on its way; the conversation shows the progress.
 */
export function ContactForm({ busy, onSend }: { busy: boolean; onSend: (email: string) => void }) {
  const formId = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value) || value.length > 254) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    setError(undefined);
    onSend(value);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${formId}-title`}
      className="fade-in flex w-full max-w-[85%] flex-col gap-2 rounded-md border border-line bg-paper px-3.5 py-3"
    >
      <p id={`${formId}-title`} className="text-sm text-ink-muted">
        What the visitor sees in the widget
      </p>
      <Field label="Where should the team reply?" error={error}>
        <div className="flex items-start gap-2">
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          <Button type="submit" disabled={busy} className="shrink-0">
            Send
          </Button>
        </div>
      </Field>
    </form>
  );
}
