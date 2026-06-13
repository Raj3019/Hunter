import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckCircle2, CircleAlert, Info, ShieldAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm font-medium shadow-sm ring-1 ring-inset [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-zinc-200 bg-white text-zinc-900 ring-zinc-100 [&>svg]:text-zinc-500",
        success: "border-emerald-200 bg-emerald-50/90 text-emerald-950 ring-emerald-100 [&>svg]:text-emerald-600",
        info: "border-sky-200 bg-sky-50/90 text-sky-950 ring-sky-100 [&>svg]:text-sky-600",
        warning: "border-amber-200 bg-amber-50/90 text-amber-950 ring-amber-100 [&>svg]:text-amber-600",
        destructive: "border-rose-200 bg-rose-50/90 text-rose-950 ring-rose-100 [&>svg]:text-rose-600",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

const VARIANT_ICON: Record<string, LucideIcon> = {
  default: Info,
  success: CheckCircle2,
  info: Info,
  warning: ShieldAlert,
  destructive: CircleAlert,
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** Override the auto icon, or pass `false` to hide it. */
  icon?: React.ReactNode | false;
  /** Renders a dismiss button on the right. */
  onClose?: () => void;
  /** Action buttons rendered as a toolbar on the right (e.g. Dismiss / Reconnect). */
  actions?: React.ReactNode;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, icon, onClose, actions, children, ...props }, ref) => {
  const Icon = VARIANT_ICON[variant ?? "default"];
  return (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {icon === false ? null : icon ?? <Icon />}
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="-mr-1 -mt-0.5 shrink-0 rounded-lg bg-white/50 p-0.5 opacity-60 transition-opacity hover:opacity-100">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
});
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn("mb-1 font-bold leading-none tracking-tight", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm font-normal leading-5 opacity-80 [&_p]:leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
