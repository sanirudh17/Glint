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
  signalOverlayCleared,
  cancelCapture,
  resetCaptureLatch,
  type OverlayData,
} from "../lib/captureIpc";
import { nextPaint } from "./nextPaint";
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
  const [displayFrame, setDisplayFrame] = useState<OverlayData | null>(null);

  const isPreviewActive = Boolean(data);

  // Keep displayFrame mounted during exit transition for smooth cross-fade
  useEffect(() => {
    if (data) {
      setDisplayFrame(data);
    } else {
      const timer = setTimeout(() => {
        setDisplayFrame(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [data]);

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
        await nextPaint();
        void signalOverlayReady(fetchMs, decodeMs);
      } catch {
        cancelCapture();
      }
    });
    return () => { un.then((f) => f()); };
  }, [monitorId]);

  // Clear-before-hide handshake (see overlay.rs `teardown_all`). On every capture
  // exit the backend emits `overlay-clear` and waits for our `overlay-cleared`
  // before hiding this reused window. We trigger the creamy fade-out transition,
  // wait for it to complete (180ms) and paint, then ack.
  useEffect(() => {
    const un = listen("overlay-clear", async () => {
      setData(null);
      await new Promise((resolve) => setTimeout(resolve, 180));
      await nextPaint();
      void signalOverlayCleared();
    });
    return () => { un.then((f) => f()); };
  }, []);

  // Global Esc handler — cancel the capture from any mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelCapture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`ov-root ${!isPreviewActive && !displayFrame ? "ov-empty" : ""}`}>
      {/*
       * Creamy preview-mode transition surface: cross-fades against the transparent desktop.
       * Animates ONLY opacity + transform (scale 0.985 <-> 1) + backdrop-filter blur ramp in glass mode.
       */}
      <div
        className={`ov-preview-surface ${isPreviewActive ? "ov-active" : ""}`}
        style={{
          backgroundImage: displayFrame ? `url(${displayFrame.imageDataUrl})` : undefined,
        }}
      />

      {/*
       * Interactive capture layer: sits above the preview surface.
       * Animates ONLY opacity — NO transform scale — ensuring selection rect,
       * badges, and handles stay 100% pixel-stable without layout shift.
       */}
      {displayFrame && (
        <div className={`ov-mode-layer ${isPreviewActive ? "ov-active" : ""}`}>
          {displayFrame.mode === "area" && (
            <SelectionLayer
              monitorId={monitorId}
              scale={displayFrame.scale}
              imageDataUrl={displayFrame.imageDataUrl}
              cursorX={displayFrame.cursorX}
              cursorY={displayFrame.cursorY}
            />
          )}
          {displayFrame.mode === "fullscreen" && (
            <FullscreenMode
              monitorId={monitorId}
              width={displayFrame.width}
              height={displayFrame.height}
              scale={displayFrame.scale}
            />
          )}
          {displayFrame.mode === "window" && (
            <WindowMode
              monitorId={monitorId}
              windows={displayFrame.windows}
              scale={displayFrame.scale}
            />
          )}
        </div>
      )}
    </div>
  );
}
