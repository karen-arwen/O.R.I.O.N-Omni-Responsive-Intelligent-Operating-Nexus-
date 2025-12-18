"use client";

import { cn } from "../../lib/utils";
import { ReactNode } from "react";
import { surfaces } from "../../lib/theme/tokens";

export function Card({ children, className, variant = "panel" }: { children: ReactNode; className?: string; variant?: keyof typeof surfaces }) {
  return <div className={cn("rounded-2xl shadow-lg", surfaces[variant], className)}>{children}</div>;
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 pt-5 pb-3 flex items-center justify-between gap-3", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-lg font-semibold tracking-tight", className)}>{children}</h3>;
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 pb-5", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 pb-5 pt-3 flex items-center gap-3", className)}>{children}</div>;
}
