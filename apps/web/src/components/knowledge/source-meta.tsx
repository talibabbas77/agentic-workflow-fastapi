"use client";

import type { Audience, KnowledgeDocument, Source } from "@docent/api-client";
import { CheckIcon, FileTextIcon, GlobeIcon, TreeStructureIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export const BUSY_SOURCE = new Set<Source["status"]>(["queued", "syncing", "deleting"]);
export const BUSY_DOCUMENT = new Set<KnowledgeDocument["status"]>(["queued", "parsing", "embedding"]);

export const audienceLabel: Record<Audience, string> = {
  public: "Everyone",
  identified: "Signed-in customers",
};

export const kindLabel: Record<Source["kind"], string> = {
  upload: "Uploaded file",
  url: "Web page",
  sitemap: "Sitemap",
};

const kindIcon = { upload: FileTextIcon, url: GlobeIcon, sitemap: TreeStructureIcon };

export function KindIcon({ kind, className }: { kind: Source["kind"]; className?: string }) {
  const Icon = kindIcon[kind];
  return <Icon aria-hidden="true" className={cn("shrink-0 text-ink-muted", className)} />;
}

export function AudienceBadge({ audience }: { audience: Audience }) {
  return <Badge tone={audience === "public" ? "outline" : "neutral"}>{audienceLabel[audience]}</Badge>;
}

const statusLabel: Record<Source["status"] | KnowledgeDocument["status"], string> = {
  queued: "Queued",
  syncing: "Syncing",
  parsing: "Reading",
  embedding: "Indexing",
  ready: "Ready",
  failed: "Failed",
  deleting: "Deleting",
};

/**
 * Status as a word with a mark: a check when ready, a warning when failed, and a
 * dot that pulses while work is in progress (static with reduced motion).
 */
export function StatusLabel({ status }: { status: Source["status"] | KnowledgeDocument["status"] }) {
  const failed = status === "failed";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", failed ? "text-rust" : "text-ink")}>
      {status === "ready" ? (
        <CheckIcon aria-hidden="true" className="size-3.5" weight="bold" />
      ) : failed ? (
        <WarningCircleIcon aria-hidden="true" className="size-3.5" weight="bold" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "mx-1 size-1.5 rounded-full motion-safe:animate-pulse",
            status === "syncing" || status === "parsing" || status === "embedding" ? "bg-rust" : "bg-ink-subtle",
          )}
        />
      )}
      {statusLabel[status]}
    </span>
  );
}
