"use client";

import Link from "next/link";
import { useTrust, useTimeline } from "../../lib/query/hooks";
import { subHours } from "date-fns";

type Alert = {
  severity: "info" | "warn" | "critical";
  message: string;
  ctaLabel: string;
  ctaHref: string;
};

export function AlertsPanel() {
  const trust = useTrust();
  const timeline = useTimeline({
    from: subHours(new Date(), 24).toISOString(),
    limit: 100,
  });

  const alerts: Alert[] = [];
  if (trust.data) {
    Object.entries(trust.data.scoresByDomain).forEach(([domain, score]) => {
      if (score < 0.4) {
        alerts.push({
          severity: "critical",
          message: `Trust baixo em ${domain} (${score.toFixed(2)})`,
          ctaLabel: "Ver trust",
          ctaHref: `/trust/${domain}`,
        });
      }
    });
  }
  const events = timeline.data?.pages.flatMap((p) => p.items) ?? [];
  events.forEach((e) => {
    if (e.type === "permission.decision" && e.payload.permissionLevel === "deny") {
      alerts.push({
        severity: "warn",
        message: "Permission deny recente",
        ctaLabel: "Ver timeline filtrada",
        ctaHref: `/timeline?correlationId=${e.correlationId ?? ""}`,
      });
    }
    if (e.type === "system.no_action") {
      alerts.push({
        severity: "info",
        message: "Silêncio repetido detectado",
        ctaLabel: "Ver fluxo",
        ctaHref: `/timeline?correlationId=${e.correlationId ?? ""}`,
      });
    }
  });

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">
        Nenhum alerta ativo.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Alertas</h3>
        <span className="text-xs text-muted-foreground">{alerts.length} ativos</span>
      </div>
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div
            key={i}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between"
          >
            <div>
              <p className="text-sm">{a.message}</p>
              <p className="text-xs text-muted-foreground">{a.severity}</p>
            </div>
            <Link className="text-xs text-primary underline" href={a.ctaHref}>
              {a.ctaLabel}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
