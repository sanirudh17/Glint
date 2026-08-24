import { lazy, Suspense, type ReactNode } from "react";
import { createHashRouter, Navigate, Outlet } from "react-router-dom";
import { Titlebar } from "./components/Titlebar";
import { NavRail } from "./components/NavRail";
import HomeView from "./views/HomeView";
const OverlayApp = lazy(() => import("./overlay/OverlayApp").then((m) => ({ default: m.OverlayApp })));
const HudApp = lazy(() => import("./hud/HudApp").then((m) => ({ default: m.HudApp })));
const PinApp = lazy(() => import("./pin/PinApp").then((m) => ({ default: m.PinApp })));
const ControlBar = lazy(() => import("./recorder/ControlBar").then((m) => ({ default: m.ControlBar })));
const Countdown = lazy(() => import("./recorder/Countdown").then((m) => ({ default: m.Countdown })));
const RegionSelect = lazy(() => import("./recorder/RegionSelect").then((m) => ({ default: m.RegionSelect })));
const RecHud = lazy(() => import("./recorder/RecHud").then((m) => ({ default: m.RecHud })));
const RecCam = lazy(() => import("./recorder/RecCam").then((m) => ({ default: m.RecCam })));
const FxOverlay = lazy(() => import("./recorder/FxOverlay").then((m) => ({ default: m.FxOverlay })));
import "./components/shell.css";

// Heavy, on-demand routes are code-split so their JS (Konva in the editor, the trim
// timeline/video, etc.) is NOT loaded into every window's renderer.
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
    path: "/overlay",
    element: lazyRoute(<OverlayApp />),
  },
  {
    path: "/hud",
    element: lazyRoute(<HudApp />),
  },
  {
    path: "/pin",
    element: lazyRoute(<PinApp />),
  },
  {
    path: "/rec-bar",
    element: lazyRoute(<ControlBar />),
  },
  {
    path: "/rec-countdown",
    element: lazyRoute(<Countdown />),
  },
  {
    path: "/rec-select",
    element: lazyRoute(<RegionSelect />),
  },
  {
    path: "/rec-hud",
    element: lazyRoute(<RecHud />),
  },
  {
    path: "/rec-cam",
    element: lazyRoute(<RecCam />),
  },
  {
    path: "/rec-fx",
    element: lazyRoute(<FxOverlay />),
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
