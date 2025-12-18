"use client";

import { useState } from "react";
import { SavedView, loadSavedViews, deleteSavedView } from "../../lib/storage/savedViews";

export function SavedViews({ onSelect }: { onSelect: (view: SavedView) => void }) {
  const [views, setViews] = useState<SavedView[]>(() => loadSavedViews());

  const remove = (name: string) => {
    deleteSavedView(name);
    setViews(loadSavedViews());
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="text-sm font-semibold">Saved views</div>
      <div className="flex flex-wrap gap-2">
        {views.map((v) => (
          <div key={v.name} className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-xs">
            <button onClick={() => onSelect(v)} className="hover:text-primary">
              {v.name}
            </button>
            <button onClick={() => remove(v.name)} aria-label="delete view">
              ×
            </button>
          </div>
        ))}
        {views.length === 0 && <span className="text-xs text-muted-foreground">Nenhum filtro salvo.</span>}
      </div>
    </div>
  );
}
