import { useEffect, useRef } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { Toast as ToastItem } from "../../store/useAppStore";
import "./ui.css";

const DISMISS_DELAY = 2400; // ms — matches --dur-slow cadence × 10

function ToastRow({ toast }: { toast: ToastItem }) {
  const dismissToast = useAppStore((s) => s.dismissToast);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      dismissToast(toast.id);
    }, DISMISS_DELAY);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [toast.id, dismissToast]);

  return (
    <div
      className="g-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {toast.text}
    </div>
  );
}

/** Mount once at the app root. Renders all active toasts; auto-dismisses each after 2.4 s. */
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="g-toast-host" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}
