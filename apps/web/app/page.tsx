"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTimeline, useTrust } from "../lib/query/hooks";
import AppShell from "../components/layout/AppShell";
import { ActivityHeatmap } from "../components/charts/ActivityHeatmap";
import { AlertsPanel } from "../components/alerts/AlertsPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";

export default function OverviewPage() {
  const trust = useTrust();
  const timeline = useTimeline({ from: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), limit: 20 });

  const trustAvg = useMemo(() => {
    if (!trust.data) return null;
    const vals = Object.values(trust.data.scoresByDomain);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [trust.data]);

  return (
    <AppShell>
      <div className="space-y-10">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Painel Stark</h1>
            <p className="text-sm text-muted-foreground">Centro de comando do O.R.I.O.N</p>
          </div>
          <div className="flex gap-3 text-sm text-muted-foreground">
            <Link href="/timeline" className="underline">
              Timeline
            </Link>
            <Link href="/decisions" className="underline">
              Decisoes
            </Link>
            <Link href="/trust" className="underline">
              Trust
            </Link>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Trust medio" value={trustAvg ? trustAvg.toFixed(2) : "..."} loading={trust.isLoading} />
          <KpiCard title="Dominios rastreados" value={trust.data ? Object.keys(trust.data.scoresByDomain).length : "..."} loading={trust.isLoading} />
          <KpiCard title="Eventos (24h)" value={timeline.data?.pages?.[0]?.items?.length ?? "..."} loading={timeline.isLoading} />
          <KpiCard title="API" value={trust.isError ? "Offline" : "Online"} loading={trust.isLoading} />
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Ultimas atividades</CardTitle>
              <CardDescription>Timeline sanitizada das decisoes recentes</CardDescription>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/timeline">Ver timeline</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {timeline.isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}
            {timeline.data?.pages?.[0]?.items?.slice(0, 10).map((item) => (
              <div key={item.id} className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3 border border-white/5">
                <div>
                  <p className="text-sm font-medium">{item.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.kind} › {item.domain} › {new Date(item.timestamp).toLocaleString()}
                  </p>
                </div>
                <Link href={`/decisions/${item.decisionId ?? ""}`} className="text-xs text-primary underline">
                  detalhes
                </Link>
              </div>
            ))}
            {!timeline.isLoading && (timeline.data?.pages?.[0]?.items?.length ?? 0) === 0 && (
              <div className="text-sm text-muted-foreground">Nenhum evento encontrado.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Trust por dominio</CardTitle>
              <CardDescription>Scores e defaults por dominio</CardDescription>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/trust">Ver detalhes</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {trust.data
                ? Object.entries(trust.data.scoresByDomain).map(([domain, score]) => (
                    <div key={domain} className="rounded-lg border border-white/5 bg-white/5 p-4">
                      <p className="text-sm text-muted-foreground">{domain}</p>
                      <p className="text-xl font-semibold">{score.toFixed(2)}</p>
                    </div>
                  ))
                : (
                  <div className="text-sm text-muted-foreground">Carregando...</div>
                )}
            </div>
          </CardContent>
        </Card>

        <ActivityHeatmap />

        <AlertsPanel />
      </div>
    </AppShell>
  );
}

const KpiCard = ({ title, value, loading }: { title: string; value: string | number; loading?: boolean }) => (
  <Card variant="glow" className="p-4">
    <p className="text-sm text-muted-foreground">{title}</p>
    <p className="text-2xl font-semibold">{loading ? <Skeleton className="h-6 w-12" /> : value}</p>
  </Card>
);
