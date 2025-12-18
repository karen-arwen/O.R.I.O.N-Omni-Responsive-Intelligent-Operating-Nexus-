"use client";

import { TimelineItem } from "../../lib/types";
import { buildExplain } from "../../lib/explain/buildExplain";

export function DecisionExplain({ snapshot, events }: { snapshot?: any; events: TimelineItem[] }) {
  const explain = buildExplain({ snapshot, events });

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
      <h3 className="text-sm font-semibold">{explain.narrativeTitle}</h3>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
        {explain.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}
