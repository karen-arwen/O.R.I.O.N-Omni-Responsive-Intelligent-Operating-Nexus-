"use client";

import AppShell from "../../components/layout/AppShell";

export default function PoliciesPage() {
  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">Policy Inspector</h1>
          <p className="text-sm text-muted-foreground">Read-only, regras atuais</p>
        </header>
        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2 text-sm">
          <p>Risk precedence: PermissionEngine pode elevar risco, nunca reduzir.</p>
          <p>RequiresApproval mantém decisão em suggest; deny força no_action.</p>
          <p>Capabilities: canExecute=false (v0), apenas sinaliza.</p>
          <p>Trust defaults: finance/security=0.3; agenda/tasks=0.6; messaging/generic=0.5.</p>
          <p>Deltas: accept +0.10, reject -0.15, implicit repeat no_action -0.05.</p>
          <p>Snapshot persistido em evento final; idempotência por decisionId.</p>
        </section>
      </div>
    </AppShell>
  );
}
