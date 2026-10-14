"use client";

import type { ChatMessage, Citation } from "@docent/api-client";
import { ArrowSquareOutIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Fragment, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";

/**
 * One message in the preview. Agent text goes through the same rules as the
 * widget's renderer: paragraphs, line breaks, **bold**, [n] citation chips, and
 * links only to the message's own cited URLs. Everything else stays plain text,
 * and nothing is ever parsed as HTML.
 */
export function ChatMessageItem({ message, children }: { message: ChatMessage; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const sourcesId = useId();

  if (message.role === "visitor") {
    return (
      <li className="flex flex-col items-end">
        <span className="sr-only">Customer: </span>
        <p
          dir="auto"
          className="max-w-[85%] rounded-md bg-surface-2 px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-ink"
        >
          {message.content}
        </p>
      </li>
    );
  }

  if (message.role === "system") {
    return (
      <li dir="auto" className="text-center text-sm text-ink-muted">
        {message.content}
      </li>
    );
  }

  const sourceId = (marker: number) => `${sourcesId}-${marker}`;

  function cite(marker: number) {
    setOpen(true);
    setActive(marker);
    // The list renders on this click; focus the source once it is on the page.
    requestAnimationFrame(() => document.getElementById(sourceId(marker))?.focus());
  }

  const confidence = message.decision?.type === "answer" ? message.decision.confidence : null;
  // Claims from the signed token that the answer relies on, rather than a source.
  const facts = message.decision?.account_facts ?? [];
  // Conversation such as a greeting states no facts, so it shows no sources or confidence.
  const conversational = message.decision?.type === "reply";

  return (
    <li className="flex flex-col items-start gap-2">
      <span className="sr-only">{message.role === "human" ? "Your team" : "Agent"}: </span>
      <div className="flex max-w-[85%] flex-col gap-2 rounded-md border border-line bg-paper px-3.5 py-2.5 text-base break-words text-ink">
        <MessageText text={message.content} citations={conversational ? [] : message.citations} onCite={cite} />
      </div>
      {!conversational && (message.citations.length > 0 || facts.length > 0) ? (
        <div className="flex w-full max-w-[85%] flex-col gap-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            {message.citations.length > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={sourcesId}
                onClick={() => setOpen((value) => !value)}
                className="inline-flex items-center gap-1 rounded-sm font-medium transition-colors duration-150 hover:text-ink"
              >
                <CaretRightIcon
                  aria-hidden="true"
                  className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
                  weight="bold"
                />
                {message.citations.length} {plural(message.citations.length, "source")}
              </button>
            ) : null}
            {facts.length > 0 ? (
              <span>
                From customer details: <span className="font-mono text-ink">{facts.join(", ")}</span>
              </span>
            ) : null}
            {confidence ? <span>{confidenceLabel[confidence]}</span> : null}
          </p>
          {message.citations.length > 0 ? (
            <ol id={sourcesId} aria-label="Sources" hidden={!open} className="flex flex-col gap-2">
              {[...message.citations]
                .sort((a, b) => a.marker - b.marker)
                .map((citation) => (
                  <Source
                    key={citation.marker}
                    id={sourceId(citation.marker)}
                    citation={citation}
                    active={active === citation.marker}
                  />
                ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      {children}
    </li>
  );
}

export const confidenceLabel = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

const chipClasses =
  "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm border border-rust/30 bg-rust-soft px-1 text-xs leading-none font-medium text-rust tabular-nums";

const linkClasses =
  "rounded-sm text-rust underline decoration-rust/30 underline-offset-[3px] transition-colors duration-150 hover:text-rust-hover";

export function Source({ id, citation, active }: { id: string; citation: Citation; active: boolean }) {
  const url = safeUrl(citation.url);
  // The heading path starts with the document title, which is already shown above it.
  const trail = citation.heading_path
    .split(" > ")
    .filter((part, index) => part && !(index === 0 && part === citation.document_title));
  return (
    <li
      id={id}
      tabIndex={-1}
      className={cn(
        "flex items-start gap-2.5 rounded-md border bg-paper px-3.5 py-3 transition-colors duration-150",
        active ? "border-rust" : "border-line",
      )}
    >
      <span aria-hidden="true" className={cn(chipClasses, "mt-0.5 shrink-0")}>
        {citation.marker}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium break-words text-ink">{citation.document_title}</p>
        {trail.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            {trail.map((part, index) => (
              <Fragment key={index}>
                {index > 0 ? <CaretRightIcon aria-hidden="true" className="size-3 text-ink-subtle" /> : null}
                <span>{part}</span>
              </Fragment>
            ))}
          </p>
        ) : null}
        {citation.excerpt ? (
          <div className="flex flex-col gap-1.5 text-sm break-words text-ink">
            <MessageText text={citation.excerpt} citations={[]} onCite={() => {}} />
          </div>
        ) : null}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(linkClasses, "inline-flex min-w-0 items-center gap-1 self-start text-sm font-medium")}
          >
            <span className="truncate">{url}</span>
            <ArrowSquareOutIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** Normalized http(s) URL, or null for anything else (javascript:, data:, relative, junk). */
function safeUrl(raw: string | null | undefined) {
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const sameUrl = (url: string) => url.replace(/\/+$/, "");

// One alternation, tried left to right: 1 bold, 2 and 3 markdown link, 4 citation marker, 5 bare URL.
const TOKEN =
  /\*\*(\S(?:[^\n]*?\S)?)\*\*|\[([^[\]\n]{1,300})\]\((https?:\/\/[^\s()<>]+)\)|\[(\d{1,3})\]|(https?:\/\/[^\s<>()[\]"']+)/g;

export function MessageText({
  text,
  citations,
  onCite,
}: {
  text: string;
  citations: Citation[];
  onCite: (marker: number) => void;
}) {
  const byMarker = new Map(citations.map((c) => [c.marker, c]));
  const allowed = new Set(
    citations.map((c) => safeUrl(c.url)).flatMap((url) => (url ? [sameUrl(url)] : [])),
  );

  const link = (raw: string, label: string, key: string): ReactNode => {
    const url = safeUrl(raw);
    if (!url || !allowed.has(sameUrl(url))) return label;
    return (
      <a key={key} href={url} target="_blank" rel="noopener noreferrer" className={linkClasses}>
        {label}
      </a>
    );
  };

  const inline = (source: string, allowBold: boolean, prefix: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = new RegExp(TOKEN.source, "g");
    let last = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      if (m[1] !== undefined && !allowBold) {
        // No nested bold: step past the "**" and keep looking for markers and links.
        re.lastIndex = m.index + 2;
        continue;
      }
      if (m.index > last) out.push(source.slice(last, m.index));
      last = m.index + m[0].length;
      const key = `${prefix}-${m.index}`;
      if (m[1] !== undefined) {
        out.push(
          <strong key={key} className="font-semibold">
            {inline(m[1], false, key)}
          </strong>,
        );
      } else if (m[2] !== undefined && m[3] !== undefined) {
        out.push(link(m[3], m[2], key));
      } else if (m[4] !== undefined) {
        const marker = Number(m[4]);
        const citation = byMarker.get(marker);
        out.push(
          citation ? (
            <button
              key={key}
              type="button"
              onClick={() => onCite(marker)}
              aria-label={`Source ${marker}: ${citation.document_title}`}
              className={cn(chipClasses, "mx-0.5 -translate-y-px align-middle transition-colors duration-150 hover:border-rust")}
            >
              {marker}
            </button>
          ) : (
            m[0]
          ),
        );
      } else if (m[5] !== undefined) {
        const trailing = /[.,;:!?]+$/.exec(m[5]);
        const url = trailing ? m[5].slice(0, trailing.index) : m[5];
        out.push(link(url, url, key));
        if (trailing) out.push(trailing[0]);
      }
    }
    if (last < source.length) out.push(source.slice(last));
    return out;
  };

  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((para) => para.replace(/^\n+|\n+$/g, ""))
    .filter((para) => para.trim());

  return paragraphs.map((para, i) => (
    <p key={i} dir="auto">
      {para.split("\n").map((line, j) => (
        <Fragment key={j}>
          {j > 0 ? <br /> : null}
          {inline(line, true, `${i}-${j}`)}
        </Fragment>
      ))}
    </p>
  ));
}
