"use client";

import { useEffect, useState } from "react";
import AppShell from "../../components/layout/AppShell";
import { loadJarvisSettings, saveJarvisSettings } from "../../lib/settings/jarvisSettings";
import { loadAuthSettings, saveAuthSettings } from "../../lib/settings/authSettings";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";

export default function SettingsPage() {
  const [jarvis, setJarvis] = useState(() => loadJarvisSettings());
  const [auth, setAuth] = useState(() => loadAuthSettings());

  useEffect(() => {
    saveJarvisSettings(jarvis);
  }, [jarvis]);

  useEffect(() => {
    saveAuthSettings(auth);
  }, [auth]);

  const baseUrl = process.env.NEXT_PUBLIC_ORION_API_BASE_URL ?? "not set";

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Painel Stark</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Tenant & Auth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm space-y-1">
                <span className="text-muted-foreground">Tenant ID</span>
                <input
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                  value={auth.tenantId}
                  onChange={(e) => setAuth({ ...auth, tenantId: e.target.value })}
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="text-muted-foreground">Bearer token</span>
                <input
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                  value={auth.token ?? ""}
                  onChange={(e) => setAuth({ ...auth, token: e.target.value })}
                />
              </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm space-y-1">
                <span className="text-muted-foreground">User ID</span>
                <input
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                  value={auth.userId ?? ""}
                  onChange={(e) => setAuth({ ...auth, userId: e.target.value })}
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="text-muted-foreground">Roles (comma)</span>
                <input
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                  value={(auth.roles ?? []).join(",")}
                  onChange={(e) => setAuth({ ...auth, roles: e.target.value.split(",").map((r) => r.trim()).filter(Boolean) })}
                />
              </label>
            </div>
            <div className="text-xs text-muted-foreground">API Base URL: {baseUrl}</div>
            <Button size="sm" variant="secondary" onClick={() => saveAuthSettings(auth)}>
              Salvar auth
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jarvis HUD</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between text-sm">
              <span>HUD</span>
              <input
                aria-label="Toggle HUD"
                type="checkbox"
                checked={jarvis.hud}
                onChange={(e) => setJarvis({ ...jarvis, hud: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>Compact mode</span>
              <input
                aria-label="Toggle compact"
                type="checkbox"
                checked={jarvis.compact}
                onChange={(e) => setJarvis({ ...jarvis, compact: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>Voice (experimental)</span>
              <input
                aria-label="Toggle voice"
                type="checkbox"
                checked={jarvis.voice}
                onChange={(e) => setJarvis({ ...jarvis, voice: e.target.checked })}
              />
            </label>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
