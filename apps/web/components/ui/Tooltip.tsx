"use client";

import * as HoverCard from "@radix-ui/react-hover-card";
import { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Tooltip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  return (
    <HoverCard.Root openDelay={150} closeDelay={50}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          className={cn(
            "rounded-lg bg-slate-900/95 border border-white/10 shadow-xl px-3 py-2 text-xs text-foreground animate-in fade-in-0 zoom-in-95",
            className
          )}
          sideOffset={6}
        >
          {content}
          <HoverCard.Arrow className="fill-slate-900/90" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
