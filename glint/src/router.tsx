import { createHashRouter, Navigate, Outlet } from "react-router-dom";
import { Titlebar } from "./components/Titlebar";
import { NavRail } from "./components/NavRail";
import HomeView from "./views/HomeView";
import LibraryView from "./views/LibraryView";
import SettingsView from "./views/SettingsView";
import EditorView from "./views/EditorView";
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
