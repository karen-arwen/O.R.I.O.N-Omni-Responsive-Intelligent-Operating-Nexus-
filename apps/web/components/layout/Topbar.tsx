"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CommandPalette } from "../command/CommandPalette";
import { useTrust } from "../../lib/query/hooks";
import { Loader2, Wifi, WifiOff, Moon, Sun, Zap } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "../../lib/utils";
import { useLiveToggle } from "../../lib/live/useLiveToggle";
import { loadJarvisSettings, saveJarvisSettings } from "../../lib/settings/jarvisSettings";
import { useVoiceCommands } from "../../lib/voice/useVoiceCommands";
import { Button } from "../ui/Button";

export default function Topbar() {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const trust = useTrust();
  const { theme, setTheme } = useTheme();
  const { live, toggleLive } = useLiveToggle();
  const [hudEnabled, setHudEnabled] = useState(() => loadJarvisSettings().hud);
  const { supported, startListening } = useVoiceCommands();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const event = new CustomEvent("open-command-palette");
        window.dispatchEvent(event);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const apiStatus = useMemo(() => {
    if (trust.isFetching) return "checking";
    if (trust.isError) return "offline";
    if (trust.isSuccess) return "online";
    return "checking";
  }, [trust.isFetching, trust.isError, trust.isSuccess]);

  const onSearch = () => {
    const value = search.trim();
    if (!value) return;
    if (value.startsWith("dec-")) {
      router.push(`/decisions/${value}`);
    } else if (value.startsWith("corr-")) {
      router.push(`/timeline?correlationId=${value}`);
    } else {
      router.push(`/timeline?domain=${value}`);
    }
  };

  return (
    <div className="sticky top-0 z-30 backdrop-blur-xl bg-black/20 border-b border-white/10">
      <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-10 py-3">
        <div className="flex-1 flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Buscar decisionId / correlationId / domain"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label="Busca global"
          />
          <Button onClick={onSearch} size="sm" aria-label="Executar busca">
            Buscar
          </Button>
        </div>
        <Button
          onClick={toggleLive}
          variant={live ? "secondary" : "ghost"}
          size="sm"
          className={cn(live ? "border-emerald-400/50 text-emerald-100 bg-emerald-500/10" : "text-muted-foreground")}
          aria-label="Toggle live mode"
        >
          <Zap size={14} className="mr-1" /> {live ? "Live ON" : "Live OFF"}
        </Button>
        <ApiStatus status={apiStatus} retry={trust.refetch} />
        <Button
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          variant="ghost"
          size="sm"
          className="px-2"
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </Button>
        <Button
          aria-label="Toggle HUD"
          onClick={() => {
            setHudEnabled((v) => {
              const next = !v;
              saveJarvisSettings({ ...loadJarvisSettings(), hud: next });
              return next;
            });
          }}
          variant="ghost"
          size="sm"
        >
          HUD {hudEnabled ? "ON" : "OFF"}
        </Button>
        {supported && (
          <Button aria-label="Voice push-to-talk" onClick={startListening} variant="secondary" size="sm">
            Voice
          </Button>
        )}
      </div>
      <CommandPalette />
    </div>
  );
}

function ApiStatus({ status, retry }: { status: "online" | "offline" | "checking"; retry: () => void }) {
  if (status === "checking")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="animate-spin" size={14} /> Checking
      </span>
    );
  if (status === "offline")
    return (
      <button
        onClick={retry}
        className="flex items-center gap-1 text-xs text-red-300 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg"
        aria-label="API offline, retry"
      >
        <WifiOff size={14} /> Offline (retry)
      </button>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-lg">
      <Wifi size={14} /> Online
    </span>
  );
}
