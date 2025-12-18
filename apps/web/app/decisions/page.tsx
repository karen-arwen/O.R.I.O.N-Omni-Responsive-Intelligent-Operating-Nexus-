"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { useTimeline } from "../../lib/query/hooks";
import AppShell from "../../components/layout/AppShell";
import { AccessGuard } from "../../components/common/AccessGuard";

export default function DecisionsPage() {
  const [filters, setFilters] = useState({ decisionId: "", correlationId: "" });
  const timeline = useTimeline({
    decisionId: filters.decisionId || undefined,
    correlationId: filters.correlationId || undefined,
    kind: "decision",
    limit: 50,
  });
  const items = useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data]);

  return (
    <AppShell>
      <AccessGuard roles={["member", "admin"]}>
        <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Decisoes</h1>
              <p className="text-sm text-muted-foreground">Busque por decisionId ou correlationId</p>
            </div>
          </header>
          <div className="grid sm:grid-cols-2 gap-3">
            {["decisionId", "correlationId"].map((k) => (
              <input
                key={k}
                className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                placeholder={k}
                value={(filters as any)[k]}
                onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
              />
            ))}
          </div>

          <div className="space-y-3">
            {timeline.isLoading && <div className="text-sm text-muted-foreground">Carregando...</div>}
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{item.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.domain} • {item.type} • {new Date(item.timestamp).toLocaleString()}
                  </p>
                </div>
                {item.decisionId && (
                  <Link href={`/decisions/${item.decisionId}`} className="text-xs text-primary underline">
                    ver decisao
                  </Link>
                )}
              </div>
            ))}
            {!timeline.isLoading && items.length === 0 && <div className="text-sm text-muted-foreground">Sem resultados.</div>}
          </div>
        </div>
      </AccessGuard>
    </AppShell>
  );
}
