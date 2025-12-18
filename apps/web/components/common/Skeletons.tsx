export const CardSkeleton = () => (
  <div className="rounded-xl border border-white/10 bg-white/5 p-4 animate-pulse space-y-2">
    <div className="h-4 bg-white/10 rounded w-1/3" />
    <div className="h-3 bg-white/10 rounded w-1/2" />
  </div>
);

export const ListSkeleton = ({ count = 5 }: { count?: number }) => (
  <div className="space-y-2">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="h-16 rounded-lg bg-white/5 border border-white/10 animate-pulse" />
    ))}
  </div>
);
