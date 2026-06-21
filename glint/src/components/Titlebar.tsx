import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const win = getCurrentWindow();

/**
 * Titlebar — custom chrome for the Tauri borderless window.
 *
 * The entire bar is a drag region. Window-control buttons are explicitly
 * excluded from drag via pointer-events (handled in shell.css).
 *
 * Close calls win.close() which the Rust CloseRequested handler intercepts
 * to hide the window (close-to-tray), not terminate the process.
 */
export function Titlebar() {
  return (
    <div className="g-titlebar" data-tauri-drag-region>
      <span className="g-wordmark">Glint</span>

      <div className="g-winctl">
        <button
          className="g-winctl-btn"
          onClick={() => win.minimize()}
          aria-label="Minimize"
        >
          <Minus size={13} strokeWidth={1.75} />
        </button>

        <button
          className="g-winctl-btn"
          onClick={() => win.toggleMaximize()}
          aria-label="Toggle maximize"
        >
          <Square size={11} strokeWidth={1.75} />
        </button>

        <button
          className="g-winctl-btn g-winctl-btn--close"
          onClick={() => win.close()}
          aria-label="Close"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
