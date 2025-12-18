"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useTrustDomain, useTimeline } from "../../../lib/query/hooks";

export default function TrustDomainPage() {
  const params = useParams<{ domain: string }>();
  const domain = params.domain;
  const trust = useTrustDomain(domain);
  const timeline = useTimeline({ domain, kind: "trust", limit: 20 });

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-black text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Trust: {domain}</h1>
            <p className="text-sm text-muted-foreground">
              Atual: {trust.data ? trust.data.score.toFixed(2) : "—"} {trust.data?.fromDefault ? "(default)" : ""}
            </p>
          </div>
          <Link href="/trust" className="text-sm text-primary underline">
            Voltar
          </Link>
        </header>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <h2 className="text-lg font-semibold">Atualizações recentes</h2>
          {timeline.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {(timeline.data?.pages.flatMap((p) => p.items) ?? []).map((evt) => (
            <div key={evt.id} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
              <p className="text-sm font-medium">{evt.summary}</p>
              <p className="text-xs text-muted-foreground">
                {evt.type} • {new Date(evt.timestamp).toLocaleString()} • {evt.correlationId ?? "—"}
              </p>
            </div>
          ))}
          {!timeline.isLoading && (timeline.data?.pages.flatMap((p) => p.items).length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Sem atualizações.</p>
          )}
        </section>
      </div>
    </main>
  );
}
