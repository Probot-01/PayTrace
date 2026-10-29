import type { Metadata } from "next";
import { AccessDenied, Card, PageHeader } from "@/components/ui";
import { requirePage } from "@/server/auth/current";
import { getSettings } from "@/server/services/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { allowed } = await requirePage("settings:manage");
  if (!allowed) return <AccessDenied what="settings" />;
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Reconciliation settings"
        description="Thresholds the engine and the exception workflow use. Changes apply to new runs; each run keeps a snapshot of the settings it used. Every change is audited."
      />
      <Card className="max-w-3xl">
        <SettingsForm initial={settings} />
      </Card>
    </>
  );
}
