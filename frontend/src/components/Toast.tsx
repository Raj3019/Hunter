import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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

const TYPE_TO_VARIANT: Record<ToastType, "success" | "destructive" | "info"> = {
  success: "success",
  error: "destructive",
  info: "info",
};

const TYPE_TO_TITLE: Record<ToastType, string> = {
  success: "Done",
  error: "Action needs attention",
  info: "Heads up",
};

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  return (
    <Alert
      variant={TYPE_TO_VARIANT[toast.type]}
      onClose={onClose}
      aria-live="polite"
      className="pointer-events-auto w-[min(380px,calc(100vw-32px))] items-center shadow-xl backdrop-blur-sm"
    >
      <div className="min-w-0">
        <AlertTitle>{TYPE_TO_TITLE[toast.type]}</AlertTitle>
        <AlertDescription className="text-xs">{toast.message}</AlertDescription>
      </div>
    </Alert>
  );
}
