import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import HomeView from "./views/HomeView";
import LibraryView from "./views/LibraryView";
import SettingsView from "./views/SettingsView";
import EditorView from "./views/EditorView";

/**
 * AppShell — minimal layout placeholder.
 *
 * Task 8 replaces this with the real <Titlebar> + <NavRail> + <Outlet/> layout.
 * The structure is already wired: Titlebar sits at the top (--titlebar-h),
 * NavRail on the left (--nav-w), content fills the rest.
 */
function AppShell() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* Titlebar placeholder — Task 8 */}
      <div
        data-tauri-drag-region
        style={{
          height: "var(--titlebar-h)",
          background: "var(--bg-elev)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          paddingLeft: "var(--s4)",
        }}
      >
        <span
          style={{
            fontSize: "var(--fz-sm)",
            fontWeight: "var(--fw-medium)",
            color: "var(--text-dim)",
            letterSpacing: "0.02em",
          }}
        >
          Glint
        </span>
      </div>

      {/* Body: NavRail + content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* NavRail placeholder — Task 8 */}
        <nav
          style={{
            width: "var(--nav-w)",
            background: "var(--bg-elev)",
            borderRight: "1px solid var(--border)",
            flexShrink: 0,
          }}
          aria-label="Main navigation"
        />

        {/* Main content */}
        <main style={{ flex: 1, overflow: "auto" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
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
