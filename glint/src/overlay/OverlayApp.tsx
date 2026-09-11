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
  getOverlayMeta,
  loadOverlayFrame,
  signalOverlayReady,
  signalOverlayCleared,
  cancelCapture,
  resetCaptureLatch,
  type OverlayData,
  type OverlayMeta,
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
  // Two-leg load for instant invoke. `meta` is served in ~1ms and renders the
  // interactive chrome (selection layer, hints, loupe seed) over the live
  // desktop the moment the window shows; `frame` adds the frozen backdrop and
  // hard-cuts it in when the multi-MB image leg lands. No enter/exit animation
  // anywhere: the window snaps on at the shortcut press and off at Esc/Enter.
  const [meta, setMeta] = useState<OverlayMeta | null>(null);
  const [frame, setFrame] = useState<OverlayData | null>(null);

  // The frame is a superset of the metadata — either one can drive the chrome,
  // so a slow/failed meta leg never blocks interaction once the frame lands.
  const chrome = meta ?? frame;

  // The overlay window is pre-warmed and REUSED across captures. The mount-time
  // fetch only matters for the on-demand fallback build (a fresh window with a
  // live session); when pre-warmed at startup there's no session yet, so a failure
  // here is expected — stay transparent, don't cancel.
  useEffect(() => {
    getOverlayData(monitorId).then(setFrame).catch(() => {});
  }, [monitorId]);

  // Each capture, the backend repositions this window, emits `overlay-refresh`,
  // and shows it IMMEDIATELY (transparent at first — the live desktop shows
  // through, visually identical to the frozen frame). Both legs fire
  // concurrently: the chrome is interactive within milliseconds, the frozen
  // frame (usually served from the session's pre-encoded cache) hard-cuts in
  // right after — no fade. `overlay-ready` is logging-only for the backend's
  // [perf] line, never a gate for show(). A failed image leg means a stuck
  // overlay, so cancel.
  useEffect(() => {
    const un = listen("overlay-refresh", async () => {
      resetCaptureLatch();
      setMeta(null);
      setFrame(null);
      getOverlayMeta(monitorId).then(setMeta).catch(() => {});
      try {
        const { data, fetchMs, decodeMs } = await loadOverlayFrame(monitorId);
        setFrame(data);
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
  // before hiding this reused window. We snap to transparent instantly (no
  // fade-out), wait one committed paint so the GPU surface really is transparent
  // — otherwise the hidden window keeps this capture's frame and flashes it on
  // the next cold show — then ack so the backend hides immediately.
  useEffect(() => {
    const un = listen("overlay-clear", async () => {
      setMeta(null);
      setFrame(null);
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
    <div className={`ov-root ${!chrome && !frame ? "ov-empty" : ""}`}>
      {/*
       * Frozen-frame surface. Hard-cuts against the transparent desktop the
       * moment the image leg lands — no fade, no scale, no blur ramp.
       */}
      <div
        className={`ov-preview-surface ${frame ? "ov-active" : ""}`}
        style={{
          backgroundImage: frame ? `url(${frame.imageDataUrl})` : undefined,
        }}
      />

      {/*
       * Interactive capture layer: renders from the ~1ms metadata leg, so it
       * is live over the desktop before the frozen frame arrives. The loupe
       * appears with the frame (SelectionLayer gates it on its bitmap).
       */}
      {chrome && (
        <div className="ov-mode-layer ov-active">
          {chrome.mode === "area" && (
            <SelectionLayer
              monitorId={monitorId}
              scale={chrome.scale}
              imageDataUrl={frame?.imageDataUrl ?? null}
              loupePatch={chrome.loupePatch}
              cursorX={chrome.cursorX}
              cursorY={chrome.cursorY}
            />
          )}
          {chrome.mode === "fullscreen" && (
            <FullscreenMode
              monitorId={monitorId}
              width={chrome.width}
              height={chrome.height}
              scale={chrome.scale}
            />
          )}
          {chrome.mode === "window" && (
            <WindowMode
              monitorId={monitorId}
              windows={chrome.windows}
              scale={chrome.scale}
            />
          )}
        </div>
      )}
    </div>
  );
}
