import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; type: ToastType; message: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_TTL_MS = 5000;

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const text = (message || "").trim();
      if (!text) return;
      const id = (idRef.current += 1);
      setToasts((list) => [...list, { id, type, message: text }]);
      window.setTimeout(() => remove(id), TOAST_TTL_MS);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onClose={() => remove(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE: Record<ToastType, { color: string; Icon: typeof CheckCircle2 }> = {
  success: { color: "var(--state-success)", Icon: CheckCircle2 },
  error: { color: "var(--state-error)", Icon: AlertTriangle },
  info: { color: "var(--accent-primary)", Icon: Info },
};

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const { color, Icon } = TONE[toast.type];
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-[min(380px,calc(100vw-32px))] items-start gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-xl"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <Icon size={18} style={{ color }} className="mt-0.5 shrink-0" />
      <p className="flex-1 text-sm leading-5 text-[var(--text-primary)]">{toast.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
      >
        <X size={15} />
      </button>
    </div>
  );
}
