"use client";

import { ReactNode, useEffect, useState } from "react";
import { loadAuthSettings } from "../../lib/settings/authSettings";

export function AccessGuard({ roles, children }: { roles: string[]; children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const auth = loadAuthSettings();
    const userRoles = (auth.roles ?? []).map((r) => r.toLowerCase());
    const needed = roles.map((r) => r.toLowerCase());
    setAllowed(needed.some((role) => userRoles.includes(role)));
    setReady(true);
  }, [roles]);

  if (!ready) return null;
  if (!allowed) return <div className="p-6 text-center text-sm text-muted-foreground">Access denied</div>;
  return <>{children}</>;
}
