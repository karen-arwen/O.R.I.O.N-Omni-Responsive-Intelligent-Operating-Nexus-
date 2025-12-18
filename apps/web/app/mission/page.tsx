"use client";

import AppShell from "../../components/layout/AppShell";
import { useTimeline } from "../../lib/query/hooks";
import { useLiveToggle } from "../../lib/live/useLiveToggle";
import { useMemo, useState } from "react";
import { TimelineList } from "../../components/timeline/TimelineList";
import { AlertsPanel } from "../../components/alerts/AlertsPanel";
import { useTrust } from "../../lib/query/hooks";
import { AccessGuard } from "../../components/common/AccessGuard";

export default function MissionPage() {
  const { live, toggleLive } = useLiveToggle();
  const [autoPause, setAutoPause] = useState(true);
  const timeline = useTimeline({ limit: 50, from: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  const items = useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data]);
  const trust = useTrust();

  return (
    <AppShell>
      <AccessGuard roles={["member", "admin"]}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Mission Mode</h1>
              <p className="text-sm text-muted-foreground">Live command center</p>
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm" onClick={toggleLive}>
                {live ? "Pause Live" : "Resume Live"}
              </button>
              <button
                className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                onClick={() => timeline.refetch()}
              >
                Jump to Live
              </button>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={autoPause} onChange={(e) => setAutoPause(e.target.checked)} />
                Auto-pause on scroll
              </label>
            </div>
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <h2 className="text-sm font-semibold mb-2">Live Timeline</h2>
              <TimelineList items={items} onLoadMore={() => timeline.fetchNextPage()} hasNext={!!timeline.hasNextPage} filters={{}} />
            </div>
            <div className="space-y-3">
              <AlertsPanel />
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-semibold mb-2">Trust Radar</h3>
                <div className="space-y-2 text-sm">
                  {trust.data
                    ? Object.entries(trust.data.scoresByDomain).map(([domain, score]) => (
                        <div key={domain} className="flex items-center justify-between">
                          <span>{domain}</span>
                          <span className={score < 0.4 ? "text-red-300" : "text-emerald-200"}>{score.toFixed(2)}</span>
                        </div>
                      ))
                    : "Carregando..."}
                </div>
              </div>
            </div>
          </div>
        </div>
      </AccessGuard>
    </AppShell>
  );
}
