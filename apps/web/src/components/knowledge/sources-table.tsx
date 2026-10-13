"use client";

import type { Source } from "@docent/api-client";
import Link from "next/link";
import { formatCount, formatRelative, plural } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { AudienceBadge, KindIcon, kindLabel, StatusLabel } from "./source-meta";
import { SourceActions } from "./source-actions";

export function SourcesTable({
  sources,
  canManage,
  onChanged,
}: {
  sources: Source[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const now = useNow();
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-base max-md:block">
        <thead className="max-md:hidden">
          <tr className="border-b border-line text-sm text-ink-muted">
            <th scope="col" className="px-6 py-2.5 font-medium">
              Source
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Audience
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Documents
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Passages
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Last synced
            </th>
            {canManage ? (
              <th scope="col" className="w-16 px-6 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="max-md:block">
          {sources.map((source) => (
            <tr
              key={source.id}
              className="border-b border-line align-top transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-md:relative max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4 max-md:gap-y-2 max-md:py-4 max-md:pr-6 max-md:pl-[4.25rem]"
            >
              <td className="px-6 py-3.5 max-md:-ml-11 max-md:w-[calc(100%+2.75rem)] max-md:p-0 max-md:pr-10">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-paper">
                    <KindIcon kind={source.kind} className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={`/app/knowledge/${source.id}`}
                      className="truncate rounded-sm font-medium text-ink underline-offset-[3px] hover:underline"
                    >
                      {source.title}
                    </Link>
                    <span className="truncate text-sm text-ink-muted">{source.uri ?? kindLabel[source.kind]}</span>
                    {source.last_error ? <span className="text-sm text-rust">{source.last_error}</span> : null}
                  </div>
                </div>
              </td>
              <td className="px-3 py-3.5 max-md:p-0">
                <AudienceBadge audience={source.audience} />
              </td>
              <td className="px-3 py-3.5 max-md:p-0">
                <StatusLabel status={source.status} />
              </td>
              <td className="px-3 py-3.5 text-right tabular-nums max-md:p-0 max-md:text-sm max-md:text-ink-muted">
                {formatCount(source.document_count)}
                <span className="md:hidden"> {plural(source.document_count, "document")}</span>
              </td>
              <td className="px-3 py-3.5 text-right tabular-nums max-md:p-0 max-md:text-sm max-md:text-ink-muted">
                {formatCount(source.chunk_count)}
                <span className="md:hidden"> {plural(source.chunk_count, "passage")}</span>
              </td>
              <td className="px-3 py-3.5 whitespace-nowrap text-ink-muted max-md:p-0 max-md:text-sm">
                <span className="md:hidden">Synced </span>
                {source.last_synced_at ? formatRelative(source.last_synced_at, now) : "Not yet"}
              </td>
              {canManage ? (
                <td className="px-6 py-2.5 text-right max-md:absolute max-md:top-3 max-md:right-4 max-md:p-0">
                  <SourceActions source={source} layout="menu" onChanged={onChanged} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
