"use client";

import { useState } from "react";
import { SavedView, addSavedView, loadSavedViews } from "../../lib/storage/savedViews";
import { z } from "zod";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

const filterSchema = z.object({
  correlationId: z.string().optional(),
  decisionId: z.string().optional(),
  domain: z.string().optional(),
  kind: z.string().optional(),
  types: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type TimelineFilterValues = z.infer<typeof filterSchema>;

export function TimelineFilters({
  value,
  onChange,
}: {
  value: TimelineFilterValues;
  onChange: (v: TimelineFilterValues) => void;
}) {
  const [views, setViews] = useState<SavedView[]>(() => loadSavedViews());
  const [viewName, setViewName] = useState("");

  const onSave = () => {
    const parsed = filterSchema.safeParse(value);
    if (!parsed.success) return;
    const view: SavedView = { name: viewName || "Filtro salvo", filters: parsed.data };
    addSavedView(view);
    setViews(loadSavedViews());
    setViewName("");
  };

  const applyView = (v: SavedView) => {
    onChange(v.filters);
  };

  const reset = () => onChange({});

  return (
    <Card className="p-4 space-y-3 sticky top-16 z-20">
      <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {["correlationId", "decisionId", "domain", "types", "from", "to"].map((k) => (
          <input
            key={k}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
            placeholder={k}
            value={(value as any)[k] ?? ""}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        ))}
        <select
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
          value={value.kind ?? ""}
          onChange={(e) => onChange({ ...value, kind: e.target.value })}
        >
          <option value="">kind</option>
          <option value="decision">decision</option>
          <option value="trust">trust</option>
          <option value="system">system</option>
          <option value="audit">audit</option>
          <option value="other">other</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onChange({ ...value })}>
          Apply
        </Button>
        <Button variant="secondary" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm flex-1"
            placeholder="Nome do filtro"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
          />
          <Button variant="secondary" size="sm" onClick={onSave}>
            Salvar
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {views.map((v) => (
            <button
              key={v.name}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1"
              onClick={() => applyView(v)}
            >
              {v.name}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
