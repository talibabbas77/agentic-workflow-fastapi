import type { Metadata } from "next";
import { Suspense } from "react";
import { CalibrationView } from "@/components/evals/calibration-view";
import { EvalsDetailSkeleton } from "@/components/evals/evals-skeleton";
import { getCalibration, getMe } from "@/lib/api/server";

export const metadata: Metadata = { title: "Judge calibration" };

export default function CalibrationPage() {
  return (
    <Suspense fallback={<EvalsDetailSkeleton label="Loading calibration" />}>
      <Calibration />
    </Suspense>
  );
}

async function Calibration() {
  const [me, data] = await Promise.all([getMe(), getCalibration()]);
  const role = me.active_tenant?.role;
  return <CalibrationView initial={data} canManage={role === "owner" || role === "admin"} />;
}
