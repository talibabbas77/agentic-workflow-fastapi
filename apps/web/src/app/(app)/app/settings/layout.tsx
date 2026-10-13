import { SettingsTabs } from "@/components/app/settings-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <PageHeader title="Settings" description="Your workspace and the people in it." />
        <SettingsTabs />
      </div>
      {children}
    </div>
  );
}
