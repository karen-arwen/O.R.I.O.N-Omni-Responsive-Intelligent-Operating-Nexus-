"use client";

import Link from "next/link";
import { useMemo } from "react";
import AppShell from "../../../components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Skeleton } from "../../../components/ui/Skeleton";
import { TimelineList } from "../../../components/timeline/TimelineList";
import { useApproveJob, useCancelJob, useJob, useRetryJob, useTimeline } from "../../../lib/query/hooks";
import { toast } from "../../../components/ui/Toast";
import { loadAuthSettings } from "../../../lib/settings/authSettings";
import { exportTrace } from "../../../lib/export/exportTrace";

export default function JobDetailPage({ params }: { params: { jobId: string } }) {
  const jobId = params.jobId;
  const job = useJob(jobId);
  const jobData = job.data?.job;
  const runLog = useTimeline(jobData ? { jobId, limit: 30 } : {});
  const runItems = useMemo(() => runLog.data?.pages.flatMap((p) => p.items) ?? [], [runLog.data]);
  const cancelJob = useCancelJob();
  const retryJob = useRetryJob();
  const approveJob = useApproveJob();
  const auth = loadAuthSettings();
  const isAdmin = (auth.roles ?? []).map((r) => r.toLowerCase()).includes("admin");

  const handleCancel = async () => {
    if (!jobId) return;
    await cancelJob.mutateAsync(jobId);
    toast.success("Job cancelado");
    job.refetch();
  };

  const handleRetry = async () => {
    if (!jobId) return;
    await retryJob.mutateAsync(jobId);
    toast.success("Job reenfileirado");
    job.refetch();
  };

  const handleApprove = async () => {
    if (!jobId) return;
    await approveJob.mutateAsync({ jobId });
    toast.success("Job aprovado");
    job.refetch();
    runLog.refetch();
  };

  const handleExport = async () => {
    await exportTrace({
      correlationId: jobData?.correlationId ?? jobId,
      filters: { jobId },
      items: runItems,
    });
    toast.success("Job trace exportado");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Job {jobId}</h1>
            <p className="text-sm text-muted-foreground">Detalhe e eventos relacionados</p>
          </div>
          <Link href="/jobs" className="text-sm text-primary underline">
            Voltar para Jobs
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
            <CardDescription>Status, origem e limites</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {job.isLoading && <Skeleton className="h-16 w-full" />}
            {job.isError && <p className="text-sm text-destructive">Falha ao carregar job.</p>}
            {jobData && (
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <JobStatusBadge status={jobData.status} />
                    {jobData.domain && <Badge variant="outline">{jobData.domain}</Badge>}
                    <Badge variant="secondary">{jobData.type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    decisionId: {jobData.decisionId ?? "-"} \u00b7 correlationId: {jobData.correlationId ?? "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    attempts {jobData.attempts}/{jobData.maxAttempts} \u00b7 runAt {new Date(jobData.runAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {jobData.status === "awaiting_approval" ? (
                    isAdmin ? (
                      <Button variant="secondary" size="sm" disabled={approveJob.isLoading} onClick={handleApprove}>
                        Approve
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Admin approval required</span>
                    )
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" disabled={cancelJob.isLoading} onClick={handleCancel}>
                        Cancelar
                      </Button>
                      <Button variant="secondary" size="sm" disabled={retryJob.isLoading} onClick={handleRetry}>
                        Retry
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Run Log</CardTitle>
                  <CardDescription>Eventos sanitizados (job.* e tool.*)</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={handleExport}>
                  Export Job Trace
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {runLog.isLoading && <Skeleton className="h-24 w-full" />}
              {runItems.length > 0 && (
                <TimelineList
                  items={runItems}
                  hasNext={!!runLog.hasNextPage}
                  onLoadMore={() => runLog.fetchNextPage()}
                  filters={{
                    jobId,
                  }}
                />
              )}
              {!runLog.isLoading && runItems.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum evento encontrado.</p>
              )}
            </CardContent>
          </Card>
      </div>
    </AppShell>
  );
}

const JobStatusBadge = ({ status }: { status: string }) => {
  const color =
    status === "succeeded"
      ? "success"
      : status === "queued"
      ? "secondary"
      : status === "running"
      ? "default"
      : status === "awaiting_approval"
      ? "warning"
      : status === "failed" || status === "dead_letter"
      ? "destructive"
      : "outline";
  return <Badge variant={color as any}>{status}</Badge>;
};
