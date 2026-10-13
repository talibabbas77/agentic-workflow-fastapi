"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { useApiForm } from "@/lib/use-api-form";
import { AudienceField, readAudience } from "./audience-field";
import { UploadPanel } from "./upload-panel";

const tabs = [
  { id: "upload", label: "Upload files" },
  { id: "url", label: "Web page" },
  { id: "sitemap", label: "Sitemap" },
] as const;

type Tab = (typeof tabs)[number]["id"];

const PAGE_LIMIT_MAX = 200;

/**
 * Add a source: upload files, one web page, or every page in a sitemap.
 * `onAdded` runs after anything was added, with a short summary for a toast.
 */
export function AddSourceDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (summary: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs, as the tabs pattern expects.
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    setTab(tabs[next]!.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a source"
      description="Docent reads it, splits it into passages, and answers only from what it finds."
    >
      <div role="tablist" aria-label="Source type" className="mx-6 mt-4 flex gap-5 border-b border-line">
        {tabs.map((t, index) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${t.id}-tab`}
            aria-selected={tab === t.id}
            aria-controls={tab === t.id ? `${id}-${t.id}-panel` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(event) => onTabKey(event, index)}
            className={cn(
              "-mb-px inline-flex h-10 items-center border-b-2 text-base transition-colors duration-150",
              tab === t.id
                ? "border-rust font-medium text-ink"
                : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`}>
        {tab === "upload" ? (
          <UploadPanel onClose={onClose} onAdded={onAdded} />
        ) : (
          <LinkForm key={tab} kind={tab} onClose={onClose} onAdded={onAdded} />
        )}
      </div>
    </Dialog>
  );
}

function LinkForm({
  kind,
  onClose,
  onAdded,
}: {
  kind: "url" | "sitemap";
  onClose: () => void;
  onAdded: (summary: string) => void;
}) {
  const form = useApiForm();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const url = String(data.get("url") ?? "").trim();
    const pageLimit = Number(data.get("page_limit") ?? 1);
    const ok = form.check({
      url: !url && (kind === "url" ? "Enter the page address." : "Enter the sitemap address."),
      page_limit:
        kind === "sitemap" &&
        !(Number.isInteger(pageLimit) && pageLimit >= 1 && pageLimit <= PAGE_LIMIT_MAX) &&
        `Choose a whole number from 1 to ${PAGE_LIMIT_MAX}.`,
    });
    if (!ok) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/knowledge/sources", {
            body: {
              kind,
              url,
              audience: readAudience(data),
              // A web page is a single document.
              page_limit: kind === "sitemap" ? pageLimit : 1,
            },
          }),
        ),
      (source) => onAdded(`${source.title} is queued. Docent reads it in the background.`),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogBody className="flex flex-col gap-5">
        {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
        {kind === "url" ? (
          <Field label="Page address" error={form.fieldError("url")} hint="One page, such as a help article.">
            <Input name="url" type="url" inputMode="url" placeholder="https://help.example.com/refunds" autoFocus />
          </Field>
        ) : (
          <>
            <Field
              label="Sitemap address"
              error={form.fieldError("url")}
              hint="Docent reads the pages it lists and checks them again when you re-sync."
            >
              <Input name="url" type="url" inputMode="url" placeholder="https://help.example.com/sitemap.xml" autoFocus />
            </Field>
            <Field
              label="Most pages to read"
              error={form.fieldError("page_limit")}
              hint={`Up to ${PAGE_LIMIT_MAX}. Each page counts toward your document limit.`}
            >
              <Input name="page_limit" type="number" inputMode="numeric" min={1} max={PAGE_LIMIT_MAX} defaultValue={50} />
            </Field>
          </>
        )}
        <AudienceField error={form.fieldError("audience")} />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={form.pending}>
          {kind === "url" ? "Add page" : "Add sitemap"}
        </Button>
      </DialogFooter>
    </form>
  );
}
