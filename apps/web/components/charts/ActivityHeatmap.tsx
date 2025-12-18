import { eachHourOfInterval, subDays, startOfHour, formatISO, isSameHour } from "date-fns";
import { useTimeline } from "../../lib/query/hooks";

const hours = Array.from({ length: 24 }, (_, i) => i);
const days = Array.from({ length: 7 }, (_, i) => i);

export function ActivityHeatmap() {
  const from = subDays(new Date(), 7);
  const to = new Date();
  const timeline = useTimeline({
    from: from.toISOString(),
    to: to.toISOString(),
    limit: 200,
  });

  const items = timeline.data?.pages.flatMap((p) => p.items) ?? [];
  const grid = days.map((d) =>
    hours.map((h) => {
      const target = startOfHour(new Date(to.getTime() - d * 24 * 3600 * 1000));
      const count = items.filter((evt) => isSameHour(new Date(evt.timestamp), target) && new Date(evt.timestamp).getHours() === h).length;
      return count;
    })
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Atividade (7 dias)</h3>
        <span className="text-xs text-muted-foreground">Clique em um bloco para filtrar (futuro)</span>
      </div>
      <div className="grid grid-cols-24 gap-1">
        {grid.map((row, rowIndex) =>
          row.map((value, colIndex) => {
            const intensity = Math.min(1, value / 5);
            const bg = `rgba(59,130,246,${0.1 + intensity * 0.6})`;
            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className="w-5 h-5 rounded-sm"
                style={{ background: bg }}
                title={`${value} eventos`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
