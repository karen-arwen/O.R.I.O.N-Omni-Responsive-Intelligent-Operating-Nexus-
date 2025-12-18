"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TimelineItem } from "../../lib/types";
import { exportTrace } from "../../lib/export/exportTrace";

export function TimelineList({
  items,
  onLoadMore,
  hasNext,
  filters,
}: {
  items: TimelineItem[];
  onLoadMore: () => void;
  hasNext: boolean;
  filters: Record<string, unknown>;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: hasNext ? items.length + 1 : items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (last.index >= items.length - 1 && hasNext) {
      onLoadMore();
    }
  }, [virtualItems, items.length, hasNext, onLoadMore]);

  const rows = rowVirtualizer.getVirtualItems();

  return (
    <div ref={parentRef} data-testid="timeline-scroll" className="h-[70vh] overflow-auto rounded-xl border border-white/10 bg-white/5">
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {rows.map((virtualRow) => {
          const isLoader = virtualRow.index > items.length - 1;
          const item = items[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="px-3 py-2"
            >
              {isLoader ? (
                <div className="text-sm text-muted-foreground">Carregando...</div>
              ) : (
                <TimelineCard item={item} filters={filters} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TimelineCard = ({ item, filters }: { item: TimelineItem; filters: Record<string, unknown> }) => {
  const copy = (text?: string) => text && navigator.clipboard.writeText(text);
  const exportItem = () => exportTrace({ decisionId: item.decisionId ?? undefined, correlationId: item.correlationId ?? undefined, filters, items: [item] });

  return (
    <article className="rounded-lg border border-white/10 bg-white/5 p-4 flex items-start justify-between gap-3 hover:border-primary/40 transition">
      <div>
        <p className="text-sm font-medium">{item.summary}</p>
        <p className="text-xs text-muted-foreground">
          {item.kind} &gt; {item.domain} &gt; {new Date(item.timestamp).toLocaleString()}
        </p>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground items-end">
        <button onClick={() => copy(item.decisionId ?? "")} className="hover:text-foreground">
          copy decision
        </button>
        <button onClick={() => copy(item.correlationId ?? "")} className="hover:text-foreground">
          copy correlation
        </button>
        <button onClick={exportItem} className="hover:text-foreground">
          export trace
        </button>
      </div>
    </article>
  );
};
