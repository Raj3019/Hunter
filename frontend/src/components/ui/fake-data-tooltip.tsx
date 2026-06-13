import { type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Wraps an element whose values are illustrative placeholders (no live endpoint
 * yet). On hover it tells the user the data is not real.
 */
export function FakeDataTooltip({
  children,
  label = "Illustrative sample — not live data yet",
  className = "",
  asChild = true,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  asChild?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild} className={className}>
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-center font-medium">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {label}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
