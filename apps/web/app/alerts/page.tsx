"use client";

import AppShell from "../../components/layout/AppShell";
import { AlertsPanel } from "../../components/alerts/AlertsPanel";

export default function AlertsPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">Alerts Center</h1>
          <p className="text-sm text-muted-foreground">Deduped alerts, CTA para timeline/trust</p>
        </header>
        <AlertsPanel />
      </div>
    </AppShell>
  );
}
