"use client";

import type { Sources } from "@docent/api-client";
import { PlusIcon } from "@phosphor-icons/react";
import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatCount } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { AddSourceDialog } from "./add-source-dialog";
import { BUSY_SOURCE } from "./source-meta";
import { SourcesTable } from "./sources-table";
import { TestSearch } from "./test-search";

/**
 * The knowledge page. Starts from server data, then keeps itself current: it
 * polls only while a source is queued, syncing, or deleting.
 */
export function KnowledgeManager({
  initial,
  canManage,
  teachingFlow,
}: {
  initial: Sources;
  canManage: boolean;
  /** Server-rendered diagram for the empty state. */
  teachingFlow: ReactNode;
}) {
  const toast = useToast();
  const [data, setData] = useState(initial);
  const [adding, setAdding] = useState(false);
  // A new key per opening gives the dialog fresh state each time.
  const [dialogKey, setDialogKey] = useState(0);

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/knowledge/sources"));
    if (result.ok) setData(result.data);
  }, []);

  usePoll(
    data.sources.some((source) => BUSY_SOURCE.has(source.status)),
    refresh,
  );

  const addButton = canManage ? (
    <Button
      onClick={() => {
        setDialogKey((n) => n + 1);
        setAdding(true);
      }}
      icon={<PlusIcon aria-hidden="true" className="size-4" />}
    >
      Add source
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Knowledge"
        description="The agent answers only from these sources, and every answer cites the passage it used."
        actions={data.sources.length > 0 ? addButton : null}
      />

      {data.sources.length === 0 ? (
        <Card aria-labelledby="teaching-heading">
          <CardHeader>
            <CardTitle id="teaching-heading">How teaching works</CardTitle>
            <CardDescription>
              Add help articles, PDFs, or web pages. Docent turns them into passages it can search and cite.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-8 py-8 sm:px-8">
            {teachingFlow}
            <div className="flex justify-center text-center">
              {addButton ?? (
                <p className="text-base text-ink-muted">
                  Owners and admins add sources. Ask one of them to teach the agent.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card aria-label="Knowledge totals">
            <dl className="grid grid-cols-2 sm:grid-cols-3">
              <div className="col-span-2 flex flex-col gap-2 border-b border-line px-6 py-5 sm:col-span-1 sm:border-r sm:border-b-0">
                <dt className="text-sm text-ink-muted">Documents</dt>
                <dd className="flex flex-col gap-3">
                  <span className="tabular-nums">
                    <span className="text-2xl font-semibold text-ink">{formatCount(data.document_total)}</span>{" "}
                    <span className="text-sm text-ink-muted">of {formatCount(data.document_limit)}</span>
                  </span>
                  <ProgressBar value={data.document_total} max={data.document_limit} label="Documents used" />
                </dd>
              </div>
              <div className="flex flex-col gap-2 border-r border-line px-6 py-5">
                <dt className="text-sm text-ink-muted">Passages</dt>
                <dd className="text-2xl font-semibold text-ink tabular-nums">{formatCount(data.chunk_total)}</dd>
              </div>
              <div className="flex flex-col gap-2 px-6 py-5">
                <dt className="text-sm text-ink-muted">Sources</dt>
                <dd className="text-2xl font-semibold text-ink tabular-nums">{formatCount(data.sources.length)}</dd>
              </div>
            </dl>
          </Card>

          <Card aria-label="Sources">
            <SourcesTable sources={data.sources} canManage={canManage} onChanged={refresh} />
          </Card>
        </>
      )}

      <TestSearch disabled={!data.sources.some((source) => source.status === "ready")} />

      {canManage ? (
        <AddSourceDialog
          key={dialogKey}
          open={adding}
          onClose={() => setAdding(false)}
          onAdded={(summary) => {
            setAdding(false);
            toast({ tone: "success", title: "Source added", description: summary });
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
