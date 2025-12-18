"use client";

import { Command } from "cmdk";
import { useEffect, useState, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";

const recentKey = "orion-recent-decisions";

const baseCommands = [
  { label: "Go to Overview", action: () => "/" },
  { label: "Go to Timeline", action: () => "/timeline" },
  { label: "Go to Decisions", action: () => "/decisions" },
  { label: "Go to Trust", action: () => "/trust" },
  { label: "Go to Settings", action: () => "/settings" },
  { label: "Mission Mode", action: () => "/mission" },
  { label: "Alerts Center", action: () => "/alerts" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-command-palette", handler);
    const stored = localStorage.getItem(recentKey);
    if (stored) setRecent(JSON.parse(stored));
    return () => window.removeEventListener("open-command-palette", handler);
  }, []);

  const navigate = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  const handleSearch = () => {
    const v = value.trim();
    if (!v) return;
    if (v.startsWith("dec-")) navigate(`/decisions/${v}`);
    else if (v.startsWith("corr-")) navigate(`/timeline?correlationId=${v}`);
    else if (v.startsWith("trust:")) navigate(`/trust/${v.replace("trust:", "")}`);
  };

  const addRecent = (id: string) => {
    const next = [id, ...recent.filter((r) => r !== id)].slice(0, 5);
    setRecent(next);
    localStorage.setItem(recentKey, JSON.stringify(next));
  };

  const consoleParse = (v: string) => {
    const clean = v.replace(/^>\s*/, "");
    const parts = clean.split(" ").filter(Boolean);
    const cmd = parts[0];
    if (!cmd) return;
    if (cmd === "mission") navigate("/mission");
    else if (cmd === "alerts") navigate("/alerts");
    else if (cmd === "timeline") navigate(`/timeline?${new URLSearchParams(cleanParams(parts.slice(1))).toString()}`);
    else if (cmd === "open" && parts[1] === "decision" && parts[2]) navigate(`/decisions/${parts[2]}`);
    else if (cmd === "open" && parts[1] === "corr" && parts[2]) navigate(`/timeline?correlationId=${parts[2]}`);
    else if (cmd === "export" && parts[1] === "decision" && parts[2]) navigate(`/decisions/${parts[2]}`);
    else if (cmd === "export" && parts[1] === "corr" && parts[2]) navigate(`/timeline?correlationId=${parts[2]}`);
    else if (cmd === "toggle" && parts[1] === "live") {
      const event = new CustomEvent("toggle-live");
      window.dispatchEvent(event);
    } else if (cmd === "toggle" && parts[1] === "hud") {
      const event = new CustomEvent("toggle-hud");
      window.dispatchEvent(event);
    }
  };

  const cleanParams = (arr: string[]) => {
    const params: Record<string, string> = {};
    arr.forEach((kv) => {
      const [k, v] = kv.split("=");
      if (k && v) params[k] = v;
    });
    return params;
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm"
    >
      <Command.List className="w-full max-w-2xl mt-20 rounded-2xl border border-white/10 bg-slate-900 text-foreground shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Zap size={16} className="text-primary" />
          <Command.Input
            value={value}
            onValueChange={setValue}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                if (value.trim().startsWith(">")) {
                  consoleParse(value.trim());
                  return;
                }
                handleSearch();
              }
            }}
            placeholder="Buscar rota ou ID (dec- / corr- / trust:domain)"
            className="w-full bg-transparent outline-none text-sm"
          />
          <span className="text-[11px] text-muted-foreground">Ctrl/Cmd + K</span>
        </div>

        <Command.Empty className="px-4 py-3 text-sm text-muted-foreground">Nenhum comando</Command.Empty>

        <Command.Group heading="Navigation">
          {baseCommands.map((c) => (
            <Command.Item key={c.label} onSelect={() => navigate(c.action())} className="px-4 py-3 text-sm data-[selected=true]:bg-white/5 cursor-pointer">
              {c.label}
            </Command.Item>
          ))}
        </Command.Group>

        {recent.length > 0 && (
          <Command.Group heading="Recent decisions">
            {recent.map((id) => (
              <Command.Item
                key={id}
                onSelect={() => navigate(`/decisions/${id}`)}
                className="px-4 py-3 text-sm data-[selected=true]:bg-white/5 cursor-pointer"
              >
                {id}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Quick actions">
          <Command.Item onSelect={() => { navigate("/timeline"); }} className="px-4 py-3 text-sm data-[selected=true]:bg-white/5 cursor-pointer">
            Export current view… (use botão na página)
          </Command.Item>
          <Command.Item onSelect={() => { /* toggled via hook */ }} className="px-4 py-3 text-sm data-[selected=true]:bg-white/5 cursor-pointer">
            Toggle Live Mode
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
