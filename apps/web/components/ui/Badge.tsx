import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary/40 bg-primary/15 text-primary-foreground/80",
        secondary: "border-white/15 bg-white/10 text-foreground/90",
        success: "border-emerald-400/50 bg-emerald-500/15 text-emerald-100",
        warning: "border-amber-400/50 bg-amber-500/15 text-amber-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  className?: string;
}

export const Badge = ({ children, variant, className }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)}>{children}</span>
);
