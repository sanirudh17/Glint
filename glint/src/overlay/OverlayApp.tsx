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
import { listen } from "@tauri-apps/api/event";
import {
  getOverlayData,
  loadOverlayFrame,
  signalOverlayReady,
  cancelCapture,
  resetCaptureLatch,
  type OverlayData,
} from "../lib/captureIpc";
import { SelectionLayer } from "./SelectionLayer";
import { FullscreenMode } from "./FullscreenMode";
import { WindowMode } from "./WindowMode";
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

  // The overlay window is pre-warmed and REUSED across captures. The mount-time
  // fetch only matters for the on-demand fallback build (a fresh window with a
  // live session); when pre-warmed at startup there's no session yet, so a failure
  // here is expected — stay transparent, don't cancel.
  useEffect(() => {
    getOverlayData(monitorId).then(setData).catch(() => {});
  }, [monitorId]);

  // Each capture, the backend repositions this window (still HIDDEN) and emits
  // `overlay-refresh`, then waits for our `overlay-ready` before showing. So here
  // we fetch AND decode the new frozen frame while hidden, paint it, then signal
  // ready — the backend's show() only has to composite the already-decoded image
  // (no ~1s cold-idle repaint stall). A real failure means a stuck overlay, so
  // cancel; the backend also has a timeout fallback so it never hangs hidden.
  useEffect(() => {
    const un = listen("overlay-refresh", async () => {
      resetCaptureLatch();
      setData(null);
      try {
        const { data: frame, fetchMs, decodeMs } = await loadOverlayFrame(monitorId);
        setData(frame);
        void signalOverlayReady(fetchMs, decodeMs);
      } catch {
        cancelCapture();
      }
    });
    return () => { un.then((f) => f()); };
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

      {/* Mode router — Area / Fullscreen / Window over the shared frozen image. */}
      {data.mode === "area" && (
        <SelectionLayer
          monitorId={monitorId}
          scale={data.scale}
          imageDataUrl={data.imageDataUrl}
        />
      )}
      {data.mode === "fullscreen" && (
        <FullscreenMode
          monitorId={monitorId}
          width={data.width}
          height={data.height}
          scale={data.scale}
        />
      )}
      {data.mode === "window" && (
        <WindowMode monitorId={monitorId} windows={data.windows} scale={data.scale} />
      )}
    </div>
  );
}
