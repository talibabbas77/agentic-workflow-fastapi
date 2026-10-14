import type { Metadata } from "next";
import { Suspense } from "react";
import { MemoryManager } from "@/components/memory/memory-manager";
import { MemorySkeleton } from "@/components/memory/memory-skeleton";
import { getGaps, getMe, getMemory, getRememberedCustomers, getTeamAnswers } from "@/lib/api/server";

export const metadata: Metadata = { title: "Memory" };

export default function MemoryPage() {
  return (
    <Suspense fallback={<MemorySkeleton />}>
      <Memory />
    </Suspense>
  );
}

async function Memory() {
  const [me, overview, answers, gaps, customers] = await Promise.all([
    getMe(),
    getMemory(),
    getTeamAnswers(),
    getGaps(),
    getRememberedCustomers(),
  ]);
  const role = me.active_tenant?.role;
  return (
    <MemoryManager
      initial={{ overview, answers, gaps, customers }}
      canManage={role === "owner" || role === "admin"}
    />
  );
}
