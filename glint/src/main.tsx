import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import App from "./App";
import { applyTheme, applyAccent, THEME_STORAGE_KEY, ACCENT_STORAGE_KEY, type Theme } from "./store/useAppStore";

// Apply the persisted theme + accent SYNCHRONOUSLY, before React's first paint, so the
// app never flashes any default accent while loadSettings() does its async SQLite round-trip.
// Rust's initialization_script passes window.__GLINT_BOOT__ directly from SQLite glint.db.
try {
  const boot = (window as unknown as { __GLINT_BOOT__?: { theme?: string; accent?: string } }).__GLINT_BOOT__;
  const initialTheme = (boot?.theme as Theme | undefined) ?? (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "dark";
  applyTheme(initialTheme);
  const initialAccent = boot?.accent ?? localStorage.getItem(ACCENT_STORAGE_KEY) ?? "#2BAAAD";
  if (initialAccent) applyAccent(initialAccent);
} catch {
  document.documentElement.dataset.theme = "dark";
}

// Chrome-free transient webviews (capture overlay, HUD, pinned images) are
// transparent at the OS level so the live desktop / frozen frame shows through.
// global.css paints an opaque `body { background: var(--bg) }` (a dark substrate),
// which would otherwise flood that transparency with a solid dark-blue veil until
// the frozen screenshot finishes decoding. Force the document transparent on those
// routes — runs synchronously before React's first paint, so there's no flash.
// Also handled in index.html's head script for an even earlier override
// (before any CSS loads), but repeat here for hash changes and as a safety net.
{
  const hash = window.location.hash;
  if (
    hash.startsWith("#/overlay") ||
    hash.startsWith("#/hud") ||
    hash.startsWith("#/pin") ||
    hash.startsWith("#/rec-bar") ||
    hash.startsWith("#/rec-countdown") ||
    hash.startsWith("#/rec-select") ||
    hash.startsWith("#/rec-hud") ||
    hash.startsWith("#/rec-cam") ||
    hash.startsWith("#/rec-fx") ||
    hash.startsWith("#/rec-trim")
  ) {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  } else {
    // Non-transient windows: ensure the dark substrate is set even if the
    // head script was bypassed (e.g. hard reload). The index.html inline
    // style already paints #0C0D0F, this just keeps --bg consistent.
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = "dark";
    }
  }

}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
