import { type ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Plus } from "lucide-react";

export type FamilyAction = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

/**
 * Family Button — a morphing floating action button. Collapsed it's a circular
 * trigger; on open it springs into a rounded panel revealing a stacked action
 * menu (inspired by the Family wallet button). Built on Framer Motion.
 */
export function FamilyButton({
  actions,
  className = "",
}: {
  actions: FamilyAction[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`fixed bottom-6 right-6 z-40 flex flex-col items-end ${className}`}>
      <MotionConfig transition={{ type: "spring", bounce: 0.28, duration: 0.5 }}>
        <motion.div
          layout
          style={{ borderRadius: open ? 24 : 999 }}
          className="flex flex-col items-stretch gap-1 bg-brand-pine p-1.5 text-white shadow-[0_12px_40px_-8px_rgba(24,24,27,0.45)]"
        >
          <AnimatePresence>
            {open && (
              <motion.div layout className="flex w-[208px] flex-col gap-1 pb-1">
                {actions.map((action, i) => (
                  <motion.button
                    key={action.label}
                    type="button"
                    initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                    transition={{ delay: open ? i * 0.045 : 0, type: "spring", bounce: 0.2, duration: 0.4 }}
                    onClick={() => {
                      action.onClick();
                      setOpen(false);
                    }}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white/90 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-clay">{action.icon}</span>
                    {action.label}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            layout
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close quick actions" : "Open quick actions"}
            className="flex h-14 w-14 items-center justify-center self-end rounded-full text-white transition-colors hover:bg-white/10"
          >
            <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}>
              <Plus className="h-6 w-6" />
            </motion.span>
          </motion.button>
        </motion.div>
      </MotionConfig>
    </div>
  );
}
