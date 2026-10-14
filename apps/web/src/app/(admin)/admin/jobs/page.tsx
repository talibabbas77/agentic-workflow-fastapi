import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsoleSkeleton } from "@/components/admin/console-skeleton";
import { JobsView } from "@/components/admin/jobs-view";
import { getAdminJobs } from "@/lib/api/server";

export const metadata: Metadata = { title: "Jobs" };

export default function AdminJobsPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton label="Loading the job queue" tiles={5} />}>
      <Jobs />
    </Suspense>
  );
}

async function Jobs() {
  return <JobsView initial={await getAdminJobs()} />;
}
