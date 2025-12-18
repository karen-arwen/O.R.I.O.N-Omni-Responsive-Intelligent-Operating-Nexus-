"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import AppShell from "../../../components/layout/AppShell";
import { DecisionExplain } from "../../../components/decisions/DecisionExplain";
import { exportTrace } from "../../../lib/export/exportTrace";
import { exportBundle } from "../../../lib/export/exportBundle";
import { toast } from "../../../components/ui/Toast";
import { Button } from "../../../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useFeedbackMutation, useSnapshot, useTimeline } from "../../../lib/query/hooks";
import { AccessGuard } from "../../../components/common/AccessGuard";

export default function DecisionDetailPage() {
  const params = useParams<{ decisionId: string }>();
  const decisionId = params.decisionId;
  const snapshot = useSnapshot(decisionId);
  const timeline = useTimeline({ decisionId, kind: "decision", limit: 50 });
  const feedback = useFeedbackMutation();

  useEffect(() => {
    if (feedback.isSuccess) toast.success("Feedback registrado");
    if (feedback.isError) toast.error("Falha ao enviar feedback");
  }, [feedback.isSuccess, feedback.isError]);

  const data = snapshot.data && "snapshot" in snapshot.data ? snapshot.data : null;
  const events = useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data]);
  const etagStatus = snapshot.data && "fromCache" in snapshot.data ? (snapshot.data.fromCache ? "Cached (304)" : "Updated") : "";

  const onExportDecision = () => exportTrace({ decisionId, filters: { decisionId }, items: events, snapshot: data?.snapshot });
  const onExportBundle = async () => {
    const summary = await exportBundle({ decisionId, filters: { decisionId }, items: events, snapshot: data?.snapshot });
    toast.success("Bundle exportado");
    navigator.clipboard.writeText(summary);
  };

  return (
    <AppShell>
      <AccessGuard roles={["member", "admin"]}>
        <div className="max-w-5xl mx-auto space-y-6">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Decisao {decisionId}</h1>
              <p className="text-sm text-muted-foreground">correlation: {data?.correlationId ?? "..."}</p>
              {etagStatus && <p className="text-xs text-muted-foreground">{etagStatus}</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => feedback.mutate({ decisionId, accepted: true })} disabled={feedback.isLoading} size="sm">
                Accept
              </Button>
              <Button
                onClick={() => feedback.mutate({ decisionId, rejected: true })}
                disabled={feedback.isLoading}
                variant="secondary"
                size="sm"
              >
                Reject
              </Button>
            </div>
          </header>

          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={onExportDecision}>
              Export decision trace
            </Button>
            {data?.correlationId && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  exportTrace({ correlationId: data.correlationId, filters: { correlationId: data.correlationId }, items: events })
                }
              >
                Export correlation trace
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onExportBundle}>
              Export bundle
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {snapshot.isLoading && <p className="text-sm text-muted-foreground">Carregando snapshot...</p>}
              {data ? (
                <div className="text-sm space-y-1">
                  <div>Mode: {data.snapshot.mode ?? "..."}</div>
                  <div>Intent: {data.snapshot.intent?.type}</div>
                  <div>Domain: {data.snapshot.intent?.domain}</div>
                  <div>Explain: {(data.snapshot.explain ?? []).join(" > ")}</div>
                </div>
              ) : (
                !snapshot.isLoading && <p className="text-sm text-muted-foreground">Snapshot indisponivel.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Eventos</CardTitle>
              <span className="text-xs text-muted-foreground">Timeline filtrada</span>
            </CardHeader>
            <CardContent className="space-y-2">
              {timeline.isLoading && <p className="text-sm text-muted-foreground">Carregando eventos...</p>}
              {(timeline.data?.pages.flatMap((p) => p.items) ?? []).map((evt) => (
                <div key={evt.id} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <p className="text-sm font-medium">{evt.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {evt.type} &gt; {new Date(evt.timestamp).toLocaleString()}
                  </p>
                </div>
              ))}
              {!timeline.isLoading && events.length === 0 && <Skeleton className="h-4 w-1/3" />}
            </CardContent>
          </Card>

          <DecisionExplain snapshot={data?.snapshot} events={events} />
        </div>
      </AccessGuard>
    </AppShell>
  );
}
