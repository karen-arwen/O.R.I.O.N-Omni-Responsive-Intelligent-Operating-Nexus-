"use client";

import Link from "next/link";
import { useTrust } from "../../lib/query/hooks";
import AppShell from "../../components/layout/AppShell";
import { AccessGuard } from "../../components/common/AccessGuard";

export default function TrustPage() {
  const trust = useTrust();

  return (
    <AppShell>
      <AccessGuard roles={["admin"]}>
        <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Trust</h1>
              <p className="text-sm text-muted-foreground">Confianca por dominio</p>
            </div>
          </header>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {trust.isLoading && <div className="text-sm text-muted-foreground">Carregando...</div>}
            {trust.data &&
              Object.entries(trust.data.scoresByDomain).map(([domain, score]) => (
                <div key={domain} className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-1">
                  <p className="text-sm text-muted-foreground">{domain}</p>
                  <p className="text-xl font-semibold">{score.toFixed(2)}</p>
                  <Link className="text-xs text-primary underline" href={`/trust/${domain}`}>
                    ver detalhes
                  </Link>
                </div>
              ))}
          </div>
        </div>
      </AccessGuard>
    </AppShell>
  );
}
