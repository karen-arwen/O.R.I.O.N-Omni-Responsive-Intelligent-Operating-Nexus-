"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "../components/ui/Button";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";
  const safeMessage = isDev ? error.message : "Algo saiu do trilho. Tente novamente ou volte para o painel.";

  return (
    <html>
      <body className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black text-foreground flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4 text-center shadow-xl">
          <h2 className="text-xl font-semibold">Algo saiu do trilho</h2>
          <p className="text-sm text-muted-foreground">{safeMessage}</p>
          {isDev && (
            <p className="text-[11px] text-muted-foreground/70 break-words">
              Detalhes (dev): {error.message}
            </p>
          )}
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => reset()} size="sm">
              Tentar novamente
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/">Voltar ao painel</Link>
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
