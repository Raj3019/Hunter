import { type ReactNode, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AlertTriangle, Check } from "lucide-react";
import { Spinner } from "./spinner";

type Status = "idle" | "loading" | "success" | "error";

/**
 * Animated status button (daddy.design "family button" style): runs an async
 * action and morphs through loading (spinning ring) → success (green check) →
 * error (shake + alert), with the label sliding/blurring between states. Manages
 * its own status; the action should THROW to trigger the error state.
 */
export function StatusButton({
  onClick,
  children,
  idleIcon,
  text,
  className = "",
  resetDelay = 2800,
  minLoadingMs = 800,
  disabled,
}: {
  onClick?: () => void | Promise<unknown>;
  children: ReactNode;
  idleIcon?: ReactNode;
  text?: { loading?: string; success?: string; error?: string };
  className?: string;
  resetDelay?: number;
  minLoadingMs?: number;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const busy = status === "loading";
  const timer = useRef<number | null>(null);

  const run = async () => {
    if (busy || disabled) return;
    if (timer.current) window.clearTimeout(timer.current);
    setStatus("loading");
    // Hold the loading state for a minimum so the spinner is always perceptible,
    // even when the action resolves (or rejects) instantly.
    const minHold = new Promise<void>((res) => window.setTimeout(res, minLoadingMs));
    let failed = false;
    try {
      await onClick?.();
    } catch {
      failed = true;
    }
    await minHold;
    setStatus(failed ? "error" : "success");
    timer.current = window.setTimeout(() => setStatus("idle"), resetDelay);
  };

  const label = status === "loading" ? text?.loading ?? "Working…" : status === "success" ? text?.success ?? "Done" : status === "error" ? text?.error ?? "Failed" : null;

  const tone =
    status === "success"
      ? "bg-emerald-600 hover:bg-emerald-600"
      : status === "error"
        ? "bg-rose-600 hover:bg-rose-600"
        : "bg-brand-pine hover:bg-brand-pine-deep";

  const icon =
    status === "loading" ? (
      <Spinner className="size-4" />
    ) : status === "success" ? (
      <Check className="h-4 w-4" />
    ) : status === "error" ? (
      <AlertTriangle className="h-4 w-4" />
    ) : (
      idleIcon
    );

  return (
    <MotionConfig transition={{ type: "spring", bounce: 0.2, duration: 0.7 }}>
      <motion.button
        type="button"
        onClick={run}
        disabled={busy || disabled}
        aria-busy={busy}
        animate={status === "error" ? { x: [0, -7, 7, -6, 6, -3, 0] } : { x: 0 }}
        transition={status === "error" ? { duration: 0.7 } : { type: "spring", bounce: 0.25, duration: 0.6 }}
        className={`inline-flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-default disabled:opacity-90 ${tone} ${className}`}
      >
        {icon && (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={status} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} className="flex shrink-0 items-center">
              {icon}
            </motion.span>
          </AnimatePresence>
        )}
        <span className="relative inline-flex">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={label ?? "idle"} initial={{ opacity: 0, x: 14, filter: "blur(4px)" }} animate={{ opacity: 1, x: 0, filter: "blur(0px)" }} exit={{ opacity: 0, x: -14, filter: "blur(4px)" }} className="whitespace-nowrap">
              {label ?? children}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.button>
    </MotionConfig>
  );
}
