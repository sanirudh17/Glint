import { createHashRouter, Navigate, Outlet } from "react-router-dom";
import { Titlebar } from "./components/Titlebar";
import { NavRail } from "./components/NavRail";
import HomeView from "./views/HomeView";
import LibraryView from "./views/LibraryView";
import SettingsView from "./views/SettingsView";
import EditorView from "./views/EditorView";
import { OverlayApp } from "./overlay/OverlayApp";
import { HudApp } from "./hud/HudApp";
import { PinApp } from "./pin/PinApp";
import "./components/shell.css";

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
          <Outlet />
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
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: "home", element: <HomeView /> },
      { path: "library", element: <LibraryView /> },
      { path: "settings", element: <SettingsView /> },
      { path: "editor", element: <EditorView /> },
    ],
  },
]);
