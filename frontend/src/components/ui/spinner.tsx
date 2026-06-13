import { Loader2Icon } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

/**
 * Loading spinner — the reui Loader2 look, but the rotation is driven by JS
 * (motion) instead of the CSS `animate-spin` utility. This guarantees it spins
 * regardless of OS "reduce motion" settings or any global CSS `animation`
 * overrides. Size/colour come from `className` (defaults to 1rem, inherits the
 * current text colour).
 */
function Spinner({ className }: { className?: string }) {
  return (
    <motion.span
      role="status"
      aria-label="Loading"
      className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
    >
      <Loader2Icon className="size-full" />
    </motion.span>
  )
}

export { Spinner }
