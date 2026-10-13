"use client";

import type { Audience, SearchHit, SearchResult } from "@docent/api-client";
import { ArrowSquareOutIcon, CaretRightIcon, MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";

const EXCERPT_CHARS = 320;

const audiences: { value: Audience; label: string }[] = [
  { value: "public", label: "Anonymous visitor" },
  { value: "identified", label: "Signed-in customer" },
];

/** Ask a question the way a visitor would and see which passages the agent would use. */
export function TestSearch({ disabled }: { disabled: boolean }) {
  const form = useApiForm();
  const [audience, setAudience] = useState<Audience>("public");
  const [result, setResult] = useState<{ query: string; data: SearchResult } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    if (!form.check({ query: !query && "Type a question to search for." })) return;
    await form.run(
      () => request(api.POST("/v1/knowledge/search", { body: { query, audience, limit: 8 } })),
      (data) => setResult({ query, data }),
    );
  }

  return (
    <Card aria-labelledby="test-search-heading">
      <CardHeader>
        <CardTitle id="test-search-heading">Test search</CardTitle>
        <CardDescription>Ask what a customer would ask and see the passages the agent would answer from.</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <fieldset disabled={disabled} className="flex flex-col gap-4 disabled:opacity-60">
            <Field
              label="Question"
              error={form.fieldError("query")}
              hint={disabled ? "Search works once a source is ready." : undefined}
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input name="query" maxLength={500} placeholder="How long does a refund take?" autoComplete="off" />
                <Button
                  type="submit"
                  loading={form.pending}
                  className="shrink-0"
                  icon={<MagnifyingGlassIcon aria-hidden="true" className="size-4" />}
                >
                  Search
                </Button>
              </div>
            </Field>
            <AudienceToggle value={audience} onChange={setAudience} />
          </fieldset>
        </form>
        {result ? <Results query={result.query} data={result.data} /> : null}
      </CardBody>
    </Card>
  );
}

/** Two-option segmented control built on native radios, so arrow keys and forms just work. */
function AudienceToggle({ value, onChange }: { value: Audience; onChange: (value: Audience) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-ink">Asking as</legend>
      <div className="inline-flex self-start rounded-md border border-line-strong bg-surface-2 p-0.5">
        {audiences.map((option) => (
          <label
            key={option.value}
            className={cn(
              "relative rounded-sm px-3 py-1.5 text-sm transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-rust",
              value === option.value ? "bg-surface font-medium text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <input
              type="radio"
              name="search-audience"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Results({ query, data }: { query: string; data: SearchResult }) {
  const words = queryWords(query);
  return (
    <section aria-label="Search results" aria-live="polite" className="flex flex-col gap-4 border-t border-line pt-5">
      {data.mode === "keyword" ? (
        <p className="flex items-start gap-2 text-sm text-rust">
          <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" weight="bold" />
          Meaning search is unavailable right now, showing keyword matches.
        </p>
      ) : null}
      <p className="text-sm text-ink-muted tabular-nums">
        {data.hits.length} {plural(data.hits.length, "passage")} in {data.took_ms} ms
      </p>
      {data.hits.length === 0 ? (
        <p className="text-base text-ink-muted">
          No passages matched. Try rephrasing the question, or add a source that covers it.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {data.hits.map((hit, index) => (
            <Hit key={hit.chunk_id} hit={hit} rank={index + 1} words={words} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Hit({ hit, rank, words }: { hit: SearchHit; rank: number; words: string[] }) {
  // The heading path starts with the document title, which is already shown above it.
  const trail = hit.heading_path.split(" > ").filter((part, index) => part && !(index === 0 && part === hit.document_title));
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-paper px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium text-ink">{hit.document_title}</p>
        {hit.url ? (
          <a
            href={hit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-rust underline decoration-rust/30 underline-offset-[3px] hover:text-rust-hover"
          >
            {hit.page ? `Page ${hit.page}` : "Open page"}
            <ArrowSquareOutIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : hit.page ? (
          <span className="text-sm text-ink-muted tabular-nums">Page {hit.page}</span>
        ) : null}
      </div>
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
      <p className="text-base text-ink">{highlight(excerpt(hit.content), words)}</p>
      <p className="text-xs text-ink-muted tabular-nums">
        {[
          // Cosine similarity can dip below zero for unrelated text; show that as no match.
          hit.similarity !== null ? `Meaning match ${Math.round(Math.max(0, hit.similarity) * 100)}%` : null,
          hit.keyword_rank !== null ? `Keyword score ${hit.keyword_rank.toFixed(2)}` : null,
          `Rank ${rank}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </li>
  );
}

function excerpt(text: string) {
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 200 ? cut.lastIndexOf(" ") : EXCERPT_CHARS)}…`;
}

function queryWords(query: string) {
  return Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));
}

/** Wrap query words in <mark>, building elements instead of HTML so nothing is injected. */
function highlight(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "giu");
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-sm bg-rust-soft text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
