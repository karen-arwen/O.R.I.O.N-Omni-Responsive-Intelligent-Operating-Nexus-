"use client";

import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { HudOverlay } from "../hud/HudOverlay";
import { OfflineBanner } from "../common/OfflineBanner";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-foreground flex">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar />
        <OfflineBanner />
        <HudOverlay alertsCount={0} />
        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6">{children}</main>
      </div>
    </div>
  );
}
