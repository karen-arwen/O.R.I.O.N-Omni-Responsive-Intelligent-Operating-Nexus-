"use client";

import { useEffect, useState } from "react";
import AppShell from "../../components/layout/AppShell";
import { Automation, loadAutomations, saveAutomations } from "../../lib/storage/automations";
import { useTimeline } from "../../lib/query/hooks";
import { nanoid } from "nanoid";

export default function AutomationsPage() {
  const [autos, setAutos] = useState<Automation[]>([]);
  const timeline = useTimeline({ limit: 200 });
  const items = timeline.data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    setAutos(loadAutomations());
  }, []);

  const add = () => {
    const next: Automation = {
      id: nanoid(),
      name: "Nova automação",
      condition: { kind: "decision" },
      action: "alert",
      enabled: true,
    };
    const updated = [next, ...autos];
    setAutos(updated);
    saveAutomations(updated);
  };

  const simulate = () => {
    // Apenas um stub de simulação: conta itens que batem condição simples
    const count = items.length;
    alert(`Simulado em ${count} eventos. (Stub)`);
  };

  return (
    <AppShell>
      <div className="space-y-4 max-w-4xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Automation Studio</h1>
            <p className="text-sm text-muted-foreground">IF/THEN local-only</p>
          </div>
          <button className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm" onClick={add}>
            Nova automação
          </button>
        </header>
        <div className="space-y-2">
          {autos.map((a) => (
            <div key={a.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  kind:{a.condition.kind ?? "any"} action:{a.action}
                </p>
              </div>
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) => {
                    const updated = autos.map((au) => (au.id === a.id ? { ...au, enabled: e.target.checked } : au));
                    setAutos(updated);
                    saveAutomations(updated);
                  }}
                />
                enabled
              </label>
            </div>
          ))}
          {autos.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma automação.</p>}
        </div>
        <button className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm" onClick={simulate}>
          Run against last 200 events
        </button>
      </div>
    </AppShell>
  );
}
