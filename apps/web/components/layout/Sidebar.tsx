import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { LayoutGrid, Clock, ShieldCheck, Settings, History, Activity, ListChecks } from "lucide-react";
import { loadAuthSettings } from "../../lib/settings/authSettings";

const links = [
  { href: "/", label: "Overview", icon: LayoutGrid, roles: ["member", "admin", "public"] },
  { href: "/timeline", label: "Timeline", icon: History, roles: ["member", "admin"] },
  { href: "/decisions", label: "Decisions", icon: Clock, roles: ["member", "admin"] },
  { href: "/jobs", label: "Jobs", icon: ListChecks, roles: ["member", "admin"] },
  { href: "/trust", label: "Trust", icon: ShieldCheck, roles: ["admin"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["member", "admin", "public"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    const auth = loadAuthSettings();
    setRoles(auth.roles ?? []);
  }, []);

  const canSee = (allowed: string[]) => {
    if (!allowed.length) return true;
    const set = new Set(roles.map((r) => r.toLowerCase()));
    return allowed.some((r) => set.has(r.toLowerCase()));
  };

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r border-white/10 bg-white/5 backdrop-blur-xl transition-all",
        open ? "w-60" : "w-16"
      )}
    >
      <div className="p-4 flex items-center justify-between">
        <div className="text-lg font-semibold">O.R.I.O.N</div>
        <button
          aria-label="Toggle sidebar"
          className="text-xs text-muted-foreground"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "⟨" : "⟩"}
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {links.filter((l) => canSee(l.roles)).map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active ? "bg-primary/20 text-primary-foreground" : "text-muted-foreground hover:bg-white/5"
              )}
            >
              <Icon size={16} />
              {open && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
        <Activity size={14} />
        Live-ready
      </div>
    </aside>
  );
}
