import { useEffect, useRef, useState } from "react";
import { Section } from "../../components/ui";
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
  open_latest:"Open latest capture",
  capture_scroll:"Scrolling capture",
  capture_area_delayed: "Delayed capture area",
  capture_window_delayed: "Delayed capture window",
  capture_fullscreen_delayed: "Delayed capture fullscreen",
};

const HOTKEY_ORDER = [
  "capture_area", "capture_window", "capture_fullscreen", "record", "copy_path",
  "capture_area_delayed", "capture_window_delayed", "capture_fullscreen_delayed",
  "open_latest", "capture_scroll",
];

/** Defaults (must match Hotkeys::default() in Rust) — drives the per-row Reset affordance. */
const DEFAULTS: Record<string, string> = {
  capture_area: "CmdOrCtrl+Shift+1",
  capture_window: "CmdOrCtrl+Shift+2",
  capture_fullscreen: "CmdOrCtrl+Shift+3",
  record: "CmdOrCtrl+Shift+5",
  copy_path: "CmdOrCtrl+Shift+C",
  open_latest:"",
  capture_scroll:"",
  capture_area_delayed: "",
  capture_window_delayed: "",
  capture_fullscreen_delayed: "",
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
  // Tracks whether global shortcuts are currently suspended by THIS panel.
  // Cleared on every path where Rust re-arms them (commit) or we resume
  // (endCapture) — so the unmount cleanup below only fires when capture was
  // abandoned (navigate away / window closed mid-capture), which otherwise
  // leaks the suspend and kills every global shortcut until app restart.
  const suspendedRef = useRef(false);

  // Safety net: never leave shortcuts suspended if this panel goes away
  // mid-capture. Deliberately unmount-only (empty deps): resuming on
  // capturing-change would re-register right after commit's re-arm and hit
  // the Windows unregister/register race (see commit's comment).
  useEffect(() => {
    return () => {
      if (suspendedRef.current) {
        suspendedRef.current = false;
        void resumeHotkeys().catch(() => {});
      }
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a row is capturing, listen for the next key combo. Esc cancels; Backspace/Delete
  // clears (both also have buttons in the row, so neither needs explaining). Global shortcuts are suspended for the duration (see startCapture).
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
    suspendedRef.current = true;
    setCapturing(action);
  }

  async function endCapture() {
    await resumeHotkeys().catch(() => {});
    suspendedRef.current = false;
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
      suspendedRef.current = false;
      setCapturing(null);
    }
  }

  if (!settings) return null;

  return (
    <Section title="Keyboard shortcuts">
      <p className="settings-hotkey-help" role="note">
        Choose <strong>Change</strong>, then press a shortcut that uses <kbd className="settings-kbd">Ctrl</kbd>{" "}
        <kbd className="settings-kbd">Alt</kbd> or <kbd className="settings-kbd">Win</kbd>. Shortcuts work anywhere in Windows;
        if another app already uses one, Glint keeps your previous shortcut.
      </p>
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
                  <span className="settings-hotkey-listening" role="status">Press a shortcut…</span>
                ) : raw === "" ? (
                  <span className="settings-hotkey-empty">None</span>
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
                {isCapturing ? (
                  <>
                    {raw !== "" && (
                      <button type="button" className="settings-hotkey-btn settings-hotkey-btn--ghost" onClick={() => void commit(key, "")}>
                        <span>Clear</span>
                      </button>
                    )}
                    <button type="button" className="settings-hotkey-btn" onClick={() => void endCapture()}>
                      <span>Cancel</span>
                    </button>
                  </>
                ) : (
                  <>
                    {!isDefault && (
                      <button
                        type="button"
                        className="settings-hotkey-btn settings-hotkey-btn--ghost"
                        onClick={() => void commit(key, DEFAULTS[key])}
                      >
                        <span>Reset</span>
                      </button>
                    )}
                    <button type="button" className="settings-hotkey-btn" onClick={() => void startCapture(key)}>
                      <span>Change</span>
                    </button>
                  </>
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
          <span>Reset all to defaults</span>
        </button>
      </div>
    </Section>
  );
}
