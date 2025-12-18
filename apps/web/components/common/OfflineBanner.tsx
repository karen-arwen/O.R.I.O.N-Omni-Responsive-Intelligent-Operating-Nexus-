"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useApiHealth } from "../../lib/query/hooks";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";

export function OfflineBanner({ className }: { className?: string }) {
  const { health, retryAll } = useApiHealth();
  if (!health.isError) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 text-red-50 px-4 py-3 rounded-b-xl shadow-lg",
        className
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <AlertTriangle size={16} aria-hidden />
        <div>
          <p className="font-semibold">API offline</p>
          <p className="text-xs opacity-80">Sem conexao com o Stark Core. Revise rede ou tente novamente.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => health.refetch()} aria-label="Retry health check">
          <RefreshCw size={14} className="mr-2" /> Retry
        </Button>
        <Button size="sm" onClick={retryAll} aria-label="Retry all requests">
          <RefreshCw size={14} className="mr-2" /> Retry all
        </Button>
      </div>
    </div>
  );
}
