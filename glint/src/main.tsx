import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import App from "./App";
import { applyTheme, applyAccent, THEME_STORAGE_KEY, ACCENT_STORAGE_KEY, type Theme } from "./store/useAppStore";

// Apply the persisted theme + accent SYNCHRONOUSLY, before React's first paint, so the
// app never flashes the tokens.css default periwinkle accent while loadSettings() does
// its async SQLite round-trip. localStorage is shared across all Glint windows (one
// origin), so every window — main, HUD, overlay, selector — boots to the user's colors.
// loadSettings() later re-applies the same values from the DB (no visible change).
try {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme((storedTheme as Theme | null) ?? "dark");
  const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
  if (storedAccent) applyAccent(storedAccent);
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
  // Lift the transition gate after the first paint has used the correct
  // colors (the head script also does this; double-safe).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.documentElement.classList.add("ready"));
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
