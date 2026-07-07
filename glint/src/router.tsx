import { lazy, Suspense, type ReactNode } from "react";
import { createHashRouter, Navigate, Outlet } from "react-router-dom";
import { Titlebar } from "./components/Titlebar";
import { NavRail } from "./components/NavRail";
import HomeView from "./views/HomeView";
// Small, chrome-free transient routes stay EAGER so their windows (overlay, HUD, the
// pre-warmed region selector, etc.) render the instant they're shown.
import { OverlayApp } from "./overlay/OverlayApp";
import { HudApp } from "./hud/HudApp";
import { PinApp } from "./pin/PinApp";
import { ControlBar } from "./recorder/ControlBar";
import { Countdown } from "./recorder/Countdown";
import { RegionSelect } from "./recorder/RegionSelect";
import { RecHud } from "./recorder/RecHud";
import { RecCam } from "./recorder/RecCam";
import { FxOverlay } from "./recorder/FxOverlay";
import "./components/shell.css";

// Heavy, on-demand routes are code-split so their JS (Konva in the editor, the trim
// timeline/video, etc.) is NOT loaded into every window's renderer. This is what keeps the
// background webviews (the pre-warmed selector/overlay/HUD, the tray) lean: they never
// navigate to these routes, so their chunks are never fetched or parsed. The main window
// loads a chunk only when you actually open that view.
const LibraryView = lazy(() => import("./views/LibraryView"));
const SettingsView = lazy(() => import("./views/SettingsView"));
const EditorView = lazy(() => import("./views/EditorView"));
const TrimView = lazy(() => import("./recorder/TrimView").then((m) => ({ default: m.TrimView })));
const OcrPanel = lazy(() => import("./ocr/OcrPanel").then((m) => ({ default: m.OcrPanel })));

/** Suspense wrapper for a lazily-loaded route element. Fallback is empty — the chunk loads
 *  from local disk in a blink, and a spinner would flash more than it helps. */
const lazyRoute = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

/**
 * AppShell — the real layout: Titlebar + NavRail + scrollable content.
 *
 * Uses createHashRouter (not createBrowserRouter) so the tauri:// custom
 * protocol doesn't 404 on deep-links — hash-based routes are always
 * resolved client-side regardless of the origin.
 */
function AppShell() {
  return (
    <div className="g-shell">
      <Titlebar />
      <div className="g-shell-body">
        <NavRail />
        <main className="g-content">
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export const router = createHashRouter([
  {
    /**
     * Chrome-free overlay route — rendered WITHOUT AppShell.
     *
     * The Tauri overlay window is borderless and transparent; mounting
     * AppShell here would show a spurious Titlebar and NavRail over the
     * frozen screenshot. This top-level route sits outside the AppShell
     * parent so OverlayApp is the sole root element for this path.
     *
     * URL pattern: tauri://localhost/#/overlay?monitor=<id>
     * The ?monitor query is parsed directly from window.location.hash
     * inside OverlayApp (React Router strips query before rendering).
     */
    path: "/overlay",
    element: <OverlayApp />,
  },
  {
    /**
     * Chrome-free HUD route — the post-capture bar. Like /overlay it sits
     * outside AppShell so HudApp is the sole root for this transparent,
     * borderless window. URL: tauri://localhost/#/hud
     */
    path: "/hud",
    element: <HudApp />,
  },
  {
    /**
     * Chrome-free pin route — a floating always-on-top image window. Like
     * /overlay and /hud it sits outside AppShell so PinApp is the sole root.
     * URL: tauri://localhost/#/pin (window label distinguishes each pin).
     */
    path: "/pin",
    element: <PinApp />,
  },
  {
    /**
     * Chrome-free recorder control bar — floating REC indicator (dot + timer +
     * Stop). Like /pin it sits outside AppShell so ControlBar is the sole root.
     * URL: tauri://localhost/#/rec-bar
     */
    path: "/rec-bar",
    element: <ControlBar />,
  },
  {
    /**
     * Chrome-free countdown overlay — 3·2·1 before recording starts. Fullscreen,
     * click-through, closes itself at 0. URL: tauri://localhost/#/rec-countdown
     */
    path: "/rec-countdown",
    element: <Countdown />,
  },
  {
    /**
     * Chrome-free live region selector — fullscreen transparent overlay where the
     * user drags a rectangle to define the recording region. Takes focus (not
     * click-through) so it receives pointer and Esc events.
     * URL: tauri://localhost/#/rec-select
     */
    path: "/rec-select",
    element: <RegionSelect />,
  },
  {
    /**
     * Chrome-free post-recording HUD — a floating card with the finished video's
     * thumbnail + quick actions, bottom-left. URL: tauri://localhost/#/rec-hud
     */
    path: "/rec-hud",
    element: <RecHud />,
  },
  {
    /**
     * Chrome-free webcam bubble — a circular live camera feed that sits on screen
     * and is intentionally NOT excluded from capture so gdigrab records it.
     * URL: tauri://localhost/#/rec-cam
     */
    path: "/rec-cam",
    element: <RecCam />,
  },
  {
    /**
     * Chrome-free FX overlay — transparent, click-through; gdigrab records whatever
     * it draws (click ripples, keystroke chips, cursor spotlight). Sits outside
     * AppShell so FxOverlay is the sole root. URL: tauri://localhost/#/rec-fx
     */
    path: "/rec-fx",
    element: <FxOverlay />,
  },
  {
    /**
     * Normal decorated trim window — a standalone resizable app window (its own OS
     * titlebar) for trimming a finished recording. Sits outside AppShell so TrimView
     * is the sole root. URL: tauri://localhost/#/rec-trim
     */
    path: "/rec-trim",
    element: lazyRoute(<TrimView />),
  },
  {
    /**
     * Normal decorated OCR review panel — a small standalone window (its own OS
     * titlebar) showing text extracted from a capture. Sits outside AppShell so
     * OcrPanel is the sole root. URL: tauri://localhost/#/ocr
     */
    path: "/ocr",
    element: lazyRoute(<OcrPanel />),
  },
  {
    /**
     * Normal decorated annotation editor — its OWN standalone, resizable OS window
     * (built by editor::window), so it has room to breathe and the user can use the
     * main app alongside it. Sits OUTSIDE AppShell (no titlebar/nav rail — the OS
     * window chrome + the editor's own toolbars are all it needs). Opened by the
     * three entry points (HUD Annotate / Library Edit / Open-in-Glint), which set
     * EditorState in Rust and raise this window. URL: tauri://localhost/#/editor
     */
    path: "/editor",
    element: lazyRoute(<EditorView />),
  },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: "home", element: <HomeView /> },
      { path: "library", element: <LibraryView /> },
      { path: "settings", element: <SettingsView /> },
    ],
  },
]);
