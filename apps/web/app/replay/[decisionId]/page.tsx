"use client";

import { useParams } from "next/navigation";
import AppShell from "../../../components/layout/AppShell";
import { useTimeline } from "../../../lib/query/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { TimelineItem } from "../../../lib/types";
import { exportBundle } from "../../../lib/export/exportBundle";

export default function ReplayPage() {
  const params = useParams<{ decisionId: string }>();
  const decisionId = params.decisionId;
  const timeline = useTimeline({ decisionId, limit: 100 });
  const items = useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data]);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % Math.max(items.length, 1));
    }, 1500 / speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, items.length]);

  const current: TimelineItem | undefined = items[index];

  const exportReplay = async () => {
    await exportBundle({ decisionId, filters: { decisionId }, items });
  };

  return (
    <AppShell>
      <div className="space-y-4 max-w-5xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Replay {decisionId}</h1>
            <p className="text-sm text-muted-foreground">Linha do tempo animada</p>
          </div>
          <div className="flex gap-2 text-sm">
            <button className="rounded-lg bg-primary text-primary-foreground px-3 py-2" onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </button>
            <select
              className="rounded-lg bg-white/5 border border-white/10 px-2 py-2"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
            </select>
            <button className="rounded-lg bg-white/5 border border-white/10 px-3 py-2" onClick={exportReplay}>
              Export replay
            </button>
          </div>
        </header>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 h-64 overflow-auto">
          {items.map((evt, i) => (
            <div
              key={evt.id}
              className={`rounded-lg px-3 py-2 mb-2 border ${i === index ? "border-primary bg-primary/10" : "border-white/10 bg-white/5"}`}
              onClick={() => setIndex(i)}
            >
              <p className="text-sm font-medium">{evt.summary}</p>
              <p className="text-xs text-muted-foreground">
                {evt.type} • {new Date(evt.timestamp).toLocaleString()}
              </p>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-muted-foreground">Sem eventos.</p>}
        </div>
        {current && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold">Evento atual</p>
            <p className="text-sm">{current.summary}</p>
            <p className="text-xs text-muted-foreground">{current.type}</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
