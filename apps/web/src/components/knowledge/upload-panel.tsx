"use client";

import { CheckIcon, FileTextIcon, UploadSimpleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { AudienceField, readAudience } from "./audience-field";

const ACCEPTED = [".pdf", ".docx", ".md", ".markdown", ".txt", ".html", ".htm"];
const MAX_BYTES = 20 * 1024 * 1024;

type Item = {
  key: string;
  file: File;
  state: "pending" | "uploading" | "done" | "error";
  message?: string;
};

/** A reason Docent will refuse the file, checked before anything is sent. */
function problemWith(file: File) {
  const dot = file.name.lastIndexOf(".");
  const extension = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
  if (!ACCEPTED.includes(extension)) return "Docent cannot read this file type.";
  if (file.size > MAX_BYTES) return "Larger than 20 MB.";
  if (file.size === 0) return "This file is empty.";
  return undefined;
}

export function UploadPanel({ onClose, onAdded }: { onClose: () => void; onAdded: (summary: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const ready = items.filter((item) => item.state === "pending");
  const added = items.filter((item) => item.state === "done").length;

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files).map((file) => {
      const message = problemWith(file);
      return {
        key: `${file.name}:${file.size}:${file.lastModified}`,
        file,
        state: message ? "error" : "pending",
        message,
      } satisfies Item;
    });
    setFinished(false);
    setItems((current) => [
      ...current.filter((item) => !incoming.some((next) => next.key === item.key)),
      ...incoming,
    ]);
  }

  function update(key: string, change: Partial<Item>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  // One request per file, in order, so each file gets its own result.
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const audience = readAudience(new FormData(event.currentTarget));
    setRunning(true);
    let failures = 0;
    for (const item of ready) {
      update(item.key, { state: "uploading" });
      const body = new FormData();
      body.append("file", item.file);
      body.append("audience", audience);
      const result = await request(
        api.POST("/v1/knowledge/uploads", { body: { file: item.file.name, audience }, bodySerializer: () => body }),
      );
      if (result.ok) {
        update(item.key, { state: "done" });
      } else {
        failures += 1;
        update(item.key, { state: "error", message: result.error.message });
      }
    }
    setRunning(false);
    const uploaded = added + ready.length - failures;
    if (failures === 0) onAdded(summary(uploaded));
    else setFinished(true);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogBody className="flex flex-col gap-5">
        <div
          role="button"
          tabIndex={0}
          aria-describedby={hintId}
          onClick={() => input.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-7 text-center transition-colors duration-150",
            dragging ? "border-rust bg-rust-soft" : "border-line-strong bg-paper hover:border-ink-subtle",
          )}
        >
          <UploadSimpleIcon aria-hidden="true" className="size-6 text-ink-muted" weight="light" />
          <p className="text-base text-ink">
            Drop files here or <span className="font-medium text-rust underline underline-offset-[3px]">choose files</span>
          </p>
          <p id={hintId} className="text-sm text-ink-muted">
            PDF, Word, Markdown, text, or HTML. Up to 20 MB each.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          aria-label="Choose files to upload"
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        {items.length > 0 ? (
          <ul aria-live="polite" className="flex flex-col divide-y divide-line rounded-md border border-line">
            {items.map((item) => (
              <li key={item.key} className="flex items-center gap-3 px-3 py-2.5">
                <FileTextIcon aria-hidden="true" className="size-4.5 shrink-0 text-ink-muted" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base text-ink">{item.file.name}</span>
                  <FileState item={item} />
                </div>
                {item.state === "pending" || (item.state === "error" && !running) ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mr-1.5 shrink-0"
                    aria-label={`Remove ${item.file.name}`}
                    disabled={running}
                    onClick={() => setItems((current) => current.filter((other) => other.key !== item.key))}
                  >
                    <XIcon aria-hidden="true" className="size-4.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <AudienceField />
      </DialogBody>
      <DialogFooter>
        {finished ? (
          <Button onClick={() => (added > 0 ? onAdded(summary(added)) : onClose())}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={running}>
              Cancel
            </Button>
            <Button type="submit" loading={running} disabled={ready.length === 0}>
              {ready.length > 1 ? `Upload ${ready.length} files` : "Upload file"}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

function summary(count: number) {
  return `${count === 1 ? "1 file" : `${count} files`} added. Docent reads them in the background.`;
}

function FileState({ item }: { item: Item }) {
  const size = formatBytes(item.file.size);
  if (item.state === "uploading") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-ink-muted">
        <span className="spinner text-xs" aria-hidden="true" />
        Uploading {size}
      </span>
    );
  }
  if (item.state === "done") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-ink">
        <CheckIcon aria-hidden="true" className="size-3.5" weight="bold" />
        Added
      </span>
    );
  }
  if (item.state === "error") {
    return (
      <span className="flex items-start gap-1.5 text-sm text-rust">
        <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
        {item.message}
      </span>
    );
  }
  return <span className="text-sm text-ink-muted">{size}, ready to upload</span>;
}
