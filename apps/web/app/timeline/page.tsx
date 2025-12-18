"use client";

import { useMemo, useState } from "react";
import { useTimeline } from "../../lib/query/hooks";
import { TimelineFilters, TimelineFilterValues } from "../../components/timeline/TimelineFilters";
import { TimelineList } from "../../components/timeline/TimelineList";
import AppShell from "../../components/layout/AppShell";
import { exportTrace } from "../../lib/export/exportTrace";
import { Button } from "../../components/ui/Button";
import { AccessGuard } from "../../components/common/AccessGuard";

export default function TimelinePage() {
  const [filters, setFilters] = useState<TimelineFilterValues>({});
  const timeline = useTimeline({
    correlationId: filters.correlationId || undefined,
    decisionId: filters.decisionId || undefined,
    domain: filters.domain || undefined,
    kind: filters.kind || undefined,
    types: filters.types || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    limit: 50,
  });
  const items = useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data]);

  const exportView = () => exportTrace({ filters, items });

  return (
    <AppShell>
      <AccessGuard roles={["member", "admin"]}>
        <div className="space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Timeline</h1>
              <p className="text-sm text-muted-foreground">Virtualizada, filtros salvos, export</p>
            </div>
            <Button onClick={exportView} variant="secondary" size="sm" aria-label="Exportar timeline atual">
              Export current view
            </Button>
          </header>
          <TimelineFilters value={filters} onChange={setFilters} />
          <TimelineList items={items} onLoadMore={() => timeline.fetchNextPage()} hasNext={!!timeline.hasNextPage} filters={filters} />
        </div>
      </AccessGuard>
    </AppShell>
  );
}
