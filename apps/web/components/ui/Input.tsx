"use client";

import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40",
        className
      )}
      {...props}
    />
  );
});
