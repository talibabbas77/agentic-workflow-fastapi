import type { CustomerFact } from "@docent/api-client";
import {
  BookOpenTextIcon,
  ChatTeardropTextIcon,
  SealQuestionIcon,
  UserCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { BranchId } from "./map-layout";

export const branchIcon: Record<BranchId, Icon> = {
  knowledge: BookOpenTextIcon,
  answers: ChatTeardropTextIcon,
  customers: UserCircleIcon,
  gaps: SealQuestionIcon,
};

export const branchLabel: Record<BranchId, string> = {
  knowledge: "Knowledge",
  answers: "Team answers",
  customers: "Customer memory",
  gaps: "Knowledge gaps",
};

/** A team answer is indexed like a source; while it is, the page polls. */
export const BUSY_ANSWER = new Set(["queued", "syncing"]);

const statusWords: Record<string, string> = {
  queued: "Waiting to be indexed",
  syncing: "Indexing",
  ready: "Ready",
  failed: "Could not be indexed",
  deleting: "Deleting",
};

export function answerStatusLabel(status: string) {
  return statusWords[status] ?? status;
}

export const factKinds: { kind: CustomerFact["kind"]; label: string }[] = [
  { kind: "issue", label: "Open issues" },
  { kind: "context", label: "Setup and context" },
  { kind: "preference", label: "Preferences" },
];
