import { EvalsTabs } from "@/components/evals/evals-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default function EvalsLayout({ children }: LayoutProps<"/app/evals">) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Evals"
          description="Test questions with the outcome you expect, run through the real agent, and how it does with your customers."
        />
        <EvalsTabs />
      </div>
      {children}
    </div>
  );
}
