"use client";

import type { SourceDetail } from "@docent/api-client";
import { ArrowLeftIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatBytes, formatCount, formatRelative, plural } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { useNow } from "@/lib/use-now";
import { AudienceBadge, BUSY_DOCUMENT, BUSY_SOURCE, KindIcon, kindLabel, StatusLabel } from "./source-meta";
import { SourceActions } from "./source-actions";

const externalLink =
  "inline-flex min-w-0 items-center gap-1 rounded-sm text-rust underline decoration-rust/30 underline-offset-[3px] hover:text-rust-hover";

/** One source and its documents. Polls while the source or any document is still being processed. */
export function SourceDetailView({ initial, canManage }: { initial: SourceDetail; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow();
  const [data, setData] = useState(initial);
  const { source, documents } = data;

  const refresh = useCallback(async () => {
    const result = await request(
      api.GET("/v1/knowledge/sources/{source_id}", { params: { path: { source_id: initial.source.id } } }),
    );
    if (result.ok) setData(result.data);
    else if (result.status === 404) {
      toast({ tone: "success", title: "Source deleted", description: initial.source.title });
      router.replace("/app/knowledge");
    }
  }, [initial.source.id, initial.source.title, router, toast]);

  usePoll(BUSY_SOURCE.has(source.status) || documents.some((doc) => BUSY_DOCUMENT.has(doc.status)), refresh);

  const link = source.kind === "upload" ? null : source.uri;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <Link
          href="/app/knowledge"
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          Knowledge
        </Link>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface">
                <KindIcon kind={source.kind} className="size-5" />
              </span>
              <h1 className="min-w-0 text-2xl break-words text-ink sm:text-3xl">{source.title}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
              <span>{kindLabel[source.kind]}</span>
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer" className={externalLink}>
                  <span className="truncate">{source.uri}</span>
                  <ArrowSquareOutIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : source.uri ? (
                <span className="truncate">{source.uri}</span>
              ) : null}
              <AudienceBadge audience={source.audience} />
              <StatusLabel status={source.status} />
            </div>
            <p className="text-sm text-ink-muted tabular-nums">
              {formatCount(source.document_count)} {plural(source.document_count, "document")} ·{" "}
              {formatCount(source.chunk_count)} {plural(source.chunk_count, "passage")} ·{" "}
              {source.last_synced_at ? `Last synced ${formatRelative(source.last_synced_at, now)}` : "Not synced yet"}
            </p>
            {source.last_error ? <p className="text-sm text-rust">{source.last_error}</p> : null}
          </div>
          {canManage ? (
            <SourceActions
              source={source}
              layout="buttons"
              onChanged={refresh}
              onDeleted={() => router.push("/app/knowledge")}
            />
          ) : null}
        </div>
      </div>

      <Card aria-labelledby="documents-heading">
        <CardHeader>
          <CardTitle id="documents-heading">Documents</CardTitle>
          <CardDescription>Each document is split into passages the agent can search and cite.</CardDescription>
        </CardHeader>
        {documents.length === 0 ? (
          <p className="px-6 py-6 text-base text-ink-muted">Docent has not read any documents from this source yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-base max-md:block">
              <thead className="max-md:hidden">
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th scope="col" className="px-6 py-2.5 font-medium">
                    Document
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Passages
                  </th>
                  <th scope="col" className="px-6 py-2.5 text-right font-medium">
                    Size
                  </th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className="border-b border-line align-top last:border-b-0 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4 max-md:gap-y-1.5 max-md:px-6 max-md:py-4"
                  >
                    <td className="px-6 py-3.5 max-md:w-full max-md:p-0">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium break-words text-ink">{doc.title || doc.locator}</span>
                        {doc.url ? (
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" className={`${externalLink} text-sm`}>
                            <span className="truncate">{doc.url}</span>
                            <ArrowSquareOutIcon aria-hidden="true" className="size-3.5 shrink-0" />
                            <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        ) : doc.title && doc.title !== doc.locator ? (
                          <span className="truncate text-sm text-ink-muted">{doc.locator}</span>
                        ) : null}
                        {doc.last_error ? <span className="text-sm text-rust">{doc.last_error}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 max-md:p-0">
                      <StatusLabel status={doc.status} />
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums max-md:p-0 max-md:text-sm max-md:text-ink-muted">
                      {formatCount(doc.chunk_count)}
                      <span className="md:hidden"> {plural(doc.chunk_count, "passage")}</span>
                    </td>
                    <td className="px-6 py-3.5 text-right whitespace-nowrap text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                      {doc.page_count !== null
                        ? `${formatCount(doc.page_count)} ${plural(doc.page_count, "page")}`
                        : doc.byte_size !== null
                          ? formatBytes(doc.byte_size)
                          : "Size unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
