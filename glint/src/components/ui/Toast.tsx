import { useEffect, useRef } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { Toast as ToastItem } from "../../store/useAppStore";
import "./ui.css";

const DISMISS_DELAY = 2400; // ms — matches --dur-slow cadence × 10

/**
 * Individual toast row. Does NOT carry its own aria-live — the host
 * container owns the single live region to avoid nested live regions
 * (which cause double-announcements in screen readers).
 */
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

  return <div className="g-toast">{toast.text}</div>;
}

/**
 * Mount once at the app root. The host is ALWAYS rendered so the
 * aria-live region exists in the DOM before the first toast arrives —
 * otherwise AT may miss the announcement of the very first toast.
 *
 * When empty: the container is fixed-positioned, pointer-events:none,
 * and has no visual presence. It is invisible and does not affect layout.
 */
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);

  return (
    <div
      className="g-toast-host"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-atomic="false"
      // pointer-events:none on the host itself; restored on individual rows via CSS
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}
