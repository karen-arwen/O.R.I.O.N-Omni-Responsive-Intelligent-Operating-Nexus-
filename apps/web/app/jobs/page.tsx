"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "../../components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { useApproveJob, useJobs } from "../../lib/query/hooks";
import { Input } from "../../components/ui/Input";
import { toast } from "../../components/ui/Toast";
import { loadAuthSettings } from "../../lib/settings/authSettings";

const statusOptions = ["queued", "running", "awaiting_approval", "succeeded", "failed", "canceled", "dead_letter"];

export default function JobsPage() {
  const [filters, setFilters] = useState({ status: "", decisionId: "", correlationId: "", domain: "" });
  const jobs = useJobs({
    status: filters.status || undefined,
    decisionId: filters.decisionId || undefined,
    correlationId: filters.correlationId || undefined,
    domain: filters.domain || undefined,
    limit: 20,
  });
  const approve = useApproveJob();
  const auth = loadAuthSettings();
  const isAdmin = (auth.roles ?? []).map((r) => r.toLowerCase()).includes("admin");

  const items = useMemo(() => jobs.data?.pages.flatMap((p) => p.jobs) ?? [], [jobs.data]);
  const unavailable = jobs.data?.pages?.some((p: any) => p.unavailable) ?? false;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Jobs</h1>
            <p className="text-sm text-muted-foreground">Pipeline de execu\u00e7\u00f5es controladas</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {jobs.isFetching ? "Atualizando..." : `${items.length} resultados`}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
            <CardDescription>Isolamento por status, decisionId, correlationId ou domain</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget as HTMLFormElement;
                const formData = new FormData(form);
                setFilters({
                  status: String(formData.get("status") ?? ""),
                  decisionId: String(formData.get("decisionId") ?? ""),
                  correlationId: String(formData.get("correlationId") ?? ""),
                  domain: String(formData.get("domain") ?? ""),
                });
                toast("Filtros aplicados");
              }}
            >
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Status</label>
                <select name="status" defaultValue={filters.status} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm">
                  <option value="">--</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">decisionId</label>
                <Input name="decisionId" defaultValue={filters.decisionId} placeholder="dec-..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">correlationId</label>
                <Input name="correlationId" defaultValue={filters.correlationId} placeholder="corr-..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">domain</label>
                <Input name="domain" defaultValue={filters.domain} placeholder="tasks/system/..." />
              </div>
              <div className="sm:col-span-4 flex justify-end gap-2">
                <Button type="submit" variant="secondary" size="sm">
                  Aplicar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters({ status: "", decisionId: "", correlationId: "", domain: "" });
                    jobs.remove();
                  }}
                >
                  Limpar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {unavailable && (
          <Card variant="glow">
            <CardContent className="text-sm text-muted-foreground">
              Jobs backend indispon\u00edvel (configure ORION_DB_URL/ORION_REDIS_URL). UI permanece somente leitura.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {jobs.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {items.map((job) => (
            <Card key={job.id} className="border-white/10 bg-white/5">
              <CardContent className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/jobs/${job.id}`} className="text-sm font-semibold hover:underline">
                      {job.id}
                    </Link>
                    <JobStatusBadge status={job.status} />
                    {job.domain && <Badge variant="outline">{job.domain}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    decisionId: {job.decisionId ?? "-"} \u00b7 correlationId: {job.correlationId ?? "-"}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground text-right space-y-1 flex flex-col items-end gap-2">
                  <div>
                    <p>type: {job.type}</p>
                    <p>
                      attempts {job.attempts}/{job.maxAttempts} \u00b7 runAt {new Date(job.runAt).toLocaleString()}
                    </p>
                  </div>
                  {job.status === "awaiting_approval" && (
                    <div className="flex gap-2">
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await approve.mutateAsync({ jobId: job.id }).then(() => toast.success("Job aprovado"));
                            jobs.refetch();
                          }}
                          disabled={approve.isLoading}
                        >
                          Approve
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Admin approval required</span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {!jobs.isLoading && items.length === 0 && (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">Nenhum job encontrado.</CardContent>
            </Card>
          )}
        </div>

        <div className="flex justify-end">
          {jobs.hasNextPage && (
            <Button variant="secondary" size="sm" onClick={() => jobs.fetchNextPage()} disabled={jobs.isFetchingNextPage}>
              Carregar mais
            </Button>
          )}
        </div>
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
