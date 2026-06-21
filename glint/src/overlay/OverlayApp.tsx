/**
 * OverlayApp.tsx — Glint capture overlay root component.
 *
 * Mounted at the chrome-free `/overlay` route. The Tauri overlay window is
 * borderless and transparent; this component must NOT render any app chrome
 * (no Titlebar, no NavRail, no shell wrapper).
 *
 * Responsibilities:
 *   1. Parse `monitor` from the hash query string (?monitor=<id>).
 *   2. Call getOverlayData() to fetch the frozen screenshot + window list.
 *   3. Render the frozen image as a fixed full-bleed background.
 *   4. Wire global Esc → cancelCapture() (closes the overlay window).
 *   5. Stay fully transparent until data arrives (no flash / no black frame).
 *
 * Tasks 9–12 will mount the interactive mode layer inside the marked comment.
 */
import { useEffect, useState } from "react";
import { getOverlayData, cancelCapture, type OverlayData } from "../lib/captureIpc";
import "./overlay.css";

// ─── Hook: parse monitor id from hash query ───────────────────────────────────
//
// The overlay window is opened with a URL like:
//   tauri://localhost/#/overlay?monitor=0
//
// React Router's hash router strips the query before rendering, so we read
// window.location.hash directly rather than useSearchParams.

function useMonitorId(): number {
  // hash is e.g. "#/overlay?monitor=2" — split on "?" to get the query part
  const q = window.location.hash.split("?")[1] ?? "";
  return Number(new URLSearchParams(q).get("monitor") ?? "0");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OverlayApp() {
  const monitorId = useMonitorId();
  const [data, setData] = useState<OverlayData | null>(null);

  // Fetch the frozen screenshot. On error, cancel (close the overlay)
  // so the user isn't left staring at a stuck transparent window.
  useEffect(() => {
    getOverlayData(monitorId).then(setData).catch(() => cancelCapture());
  }, [monitorId]);

  // Global Esc handler — cancel the capture from any mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelCapture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Transparent while loading — Tauri transparent window shows live desktop.
  if (!data) return <div className="ov-root ov-empty" />;

  return (
    <div
      className="ov-root"
      style={{ backgroundImage: `url(${data.imageDataUrl})` }}
    >
      {/*
       * ── MODE LAYER MOUNT POINT ──────────────────────────────────────────
       * Tasks 9–12 insert the interactive capture UI here.
       * The data prop shape is:
       *   data.mode       — "area" | "fullscreen" | "window"
       *   data.windows    — WindowRect[] for window-mode highlighting
       *   data.width/height/scale — monitor logical dimensions
       *   commitCapture() / cancelCapture() from captureIpc
       * ───────────────────────────────────────────────────────────────────
       */}
    </div>
  );
}
