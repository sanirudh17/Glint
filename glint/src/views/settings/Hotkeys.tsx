import { useEffect, useRef, useState } from "react";
import { Section, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { keyEventToAccelerator, toChips } from "../../lib/hotkeys";
import { suspendHotkeys, resumeHotkeys } from "../../lib/ipc";

/** Human-readable labels (must match action_label() in Rust). */
const HOTKEY_LABELS: Record<string, string> = {
  capture_area: "Capture area",
  capture_window: "Capture window",
  capture_fullscreen: "Capture fullscreen",
  record: "Record",
  copy_path: "Copy path",
};

const HOTKEY_ORDER = ["capture_area", "capture_window", "capture_fullscreen", "record", "copy_path"];

/** Defaults (must match Hotkeys::default() in Rust) — drives the per-row Reset affordance. */
const DEFAULTS: Record<string, string> = {
  capture_area: "CmdOrCtrl+Shift+1",
  capture_window: "CmdOrCtrl+Shift+2",
  capture_fullscreen: "CmdOrCtrl+Shift+3",
  record: "CmdOrCtrl+Shift+5",
  copy_path: "CmdOrCtrl+Shift+C",
};

function sameAccel(a: string, b: string): boolean {
  const norm = (s: string) => toChips(s).map((c) => c.toUpperCase()).sort().join("+");
  return norm(a) === norm(b);
}

export function Hotkeys() {
  const settings = useAppStore((s) => s.settings);
  const setHotkey = useAppStore((s) => s.setHotkey);
  const resetHotkeys = useAppStore((s) => s.resetHotkeys);

  const [capturing, setCapturing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, string>>({});
  const flashTimer = useRef<number | null>(null);

  // While a row is capturing, listen for the next key combo. Esc cancels; Backspace/Delete
  // clears. Global shortcuts are suspended for the duration (see startCapture).
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        void endCapture();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        void commit(capturing, ""); // clear/disable
        return;
      }
      const accel = keyEventToAccelerator(e);
      if (accel) void commit(capturing, accel);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  async function startCapture(action: string) {
    setErrors((e) => ({ ...e, [action]: "" }));
    await suspendHotkeys().catch(() => {});
    setCapturing(action);
  }

  async function endCapture() {
    await resumeHotkeys().catch(() => {});
    setCapturing(null);
  }

  function doFlash(action: string, msg: string) {
    setFlash((f) => ({ ...f, [action]: msg }));
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash({}), 1600);
  }

  async function commit(action: string, accel: string) {
    try {
      await setHotkey(action, accel);
      doFlash(action, accel === "" ? "Cleared" : "Updated");
      setErrors((e) => ({ ...e, [action]: "" }));
    } catch (err) {
      setErrors((e) => ({ ...e, [action]: String(err) }));
    } finally {
      // Do NOT resume here: settings_set_hotkey already re-arms shortcuts on every path
      // (success, validation error, OS reject). A second reapply would unregister then
      // re-register the just-set accelerator microseconds apart, and Windows often hasn't
      // released it yet — so the new shortcut would silently stay unregistered until the
      // next save. (Escape/cancel still resumes via endCapture, where no setHotkey ran.)
      setCapturing(null);
    }
  }

  if (!settings) return null;

  return (
    <Section
      title="Keyboard shortcuts"
      description="Global shortcuts that work anywhere in Windows."
      className="settings-section--wide"
    >
      <Card>
        <div className="settings-hotkey-help" role="note">
          <strong>How to change a shortcut</strong>
          <ol>
            <li>Click <em>Change</em> on a shortcut, then press the key combination you want.</li>
            <li>
              Every shortcut needs <kbd className="settings-kbd">Ctrl</kbd>,{" "}
              <kbd className="settings-kbd">Alt</kbd>, or <kbd className="settings-kbd">Win</kbd> plus one
              more key (Shift is optional).
            </li>
            <li>
              Press <kbd className="settings-kbd">Esc</kbd> to cancel, or{" "}
              <kbd className="settings-kbd">Backspace</kbd> to clear a shortcut.
            </li>
          </ol>
          <p>Changes apply instantly. If a shortcut is already used by another app, Glint keeps your previous one and tells you.</p>
        </div>

        <ul className="settings-hotkeys-list" role="list">
          {HOTKEY_ORDER.map((key) => {
            const raw = settings.hotkeys[key] ?? "";
            const isCapturing = capturing === key;
            const err = errors[key];
            const flashed = flash[key];
            const isDefault = sameAccel(raw, DEFAULTS[key]);
            return (
              <li key={key} className={`settings-hotkey-row${isCapturing ? " is-capturing" : ""}`}>
                <span className="settings-hotkey-label">{HOTKEY_LABELS[key] ?? key}</span>

                <span className="settings-hotkey-keys" aria-label={raw || "not set"}>
                  {isCapturing ? (
                    <span className="settings-hotkey-listening">
                      Press keys… <em>Esc to cancel</em>
                    </span>
                  ) : raw === "" ? (
                    <span className="settings-hotkey-empty">Not set</span>
                  ) : (
                    toChips(raw).map((chip, i) => (
                      <kbd key={i} className="settings-kbd">
                        {chip}
                      </kbd>
                    ))
                  )}
                </span>

                <span className="settings-hotkey-actions">
                  {flashed && <span className="settings-hotkey-flash">{flashed}</span>}
                  {!isCapturing && (
                    <button type="button" className="settings-hotkey-btn" onClick={() => void startCapture(key)}>
                      Change
                    </button>
                  )}
                  {!isCapturing && !isDefault && (
                    <button
                      type="button"
                      className="settings-hotkey-btn settings-hotkey-btn--ghost"
                      onClick={() => void commit(key, DEFAULTS[key])}
                    >
                      Reset
                    </button>
                  )}
                  {isCapturing && (
                    <button
                      type="button"
                      className="settings-hotkey-btn settings-hotkey-btn--ghost"
                      onClick={() => void endCapture()}
                    >
                      Cancel
                    </button>
                  )}
                </span>

                {err && (
                  <span className="settings-hotkey-error" role="alert">
                    {err}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="settings-hotkey-footer">
          <button
            type="button"
            className="settings-hotkey-btn settings-hotkey-btn--ghost"
            onClick={() => void resetHotkeys()}
          >
            Reset all to defaults
          </button>
        </div>
      </Card>
    </Section>
  );
}
