import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTrust, useJobsSummary } from "../../lib/query/hooks";
import { useLiveToggle } from "../../lib/live/useLiveToggle";
import { loadJarvisSettings } from "../../lib/settings/jarvisSettings";

export const HudOverlay = ({
  alertsCount,
  lastRefresh,
  lagSeconds,
}: {
  alertsCount: number;
  lastRefresh?: string;
  lagSeconds?: number;
}) => {
  const trust = useTrust();
  const { live } = useLiveToggle();
  const [enabled, setEnabled] = useState(false);
  const jobs = useJobsSummary();

  useEffect(() => {
    setEnabled(loadJarvisSettings().hud);
  }, []);

  if (!enabled) return null;
  const status = trust.isError ? "Offline" : "Online";
  const jobCounts = jobs.data?.counts ?? {};
  const jobSummary = jobs.data?.unavailable ? "Jobs offline" : `Jobs q:${jobCounts.queued ?? 0} r:${jobCounts.running ?? 0}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-40 px-4 flex justify-center">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto glass rounded-full px-4 py-2 flex items-center gap-3 border border-white/10 shadow-lg"
      >
        <span className="text-xs text-emerald-200">{status}</span>
        <span className="text-xs text-muted-foreground">Live: {live ? "ON" : "PAUSED"}</span>
        <span className="text-xs text-muted-foreground">Alerts: {alertsCount}</span>
        <span className="text-xs text-muted-foreground">{jobSummary}</span>
        {lagSeconds !== undefined && <span className="text-xs text-muted-foreground">Lag: {lagSeconds}s</span>}
        {lastRefresh && <span className="text-xs text-muted-foreground">Last: {lastRefresh}</span>}
      </motion.div>
    </div>
  );
};
