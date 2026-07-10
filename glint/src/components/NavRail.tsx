import { useCallback, useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Home, Images, Settings, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Tooltip } from "./ui";

/** localStorage key for the rail's expanded/collapsed state (main window only). */
const NAV_EXPANDED_KEY = "glint.nav-expanded";

/**
 * NavRail — vertical navigation.
 *
 * Collapses to a 52px icon rail or expands to a 200px icon+label rail via the
 * bottom toggle. The width animates in one horizontal motion (the content area
 * is flex:1, so it reflows in step); labels reveal via a synced max-width fade.
 * Tooltips only render while collapsed — when expanded the label is already
 * visible, so a bubble would be redundant.
 *
 * Active state: accent icon color + accent-subtle fill + 3px left-edge bar
 * (implemented in shell.css via ::before pseudo-element).
 *
 * Also subscribes to the Rust `navigate` event so the tray "Settings" menu
 * item can route the frontend without the user clicking in the window.
 */
export function NavRail() {
  const navigate = useNavigate();

  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(NAV_EXPANDED_KEY) === "true"; } catch { return false; }
  });

  const toggle = useCallback(() => {
    setExpanded((v) => {
      const next = !v;
      try { localStorage.setItem(NAV_EXPANDED_KEY, String(next)); } catch { /* no storage → still toggles this session */ }
      return next;
    });
  }, []);

  useEffect(() => {
    // Listen for Rust-emitted navigation events (e.g. tray → Settings)
    const unlisten = listen<string>("navigate", (event) => {
      navigate(event.payload);
    });

    return () => {
      // Clean up listener on unmount
      unlisten.then((fn) => fn());
    };
  }, [navigate]);

  return (
    <nav
      className={`g-nav-rail${expanded ? " g-nav-rail--expanded" : ""}`}
      aria-label="Main navigation"
    >
      <NavItem to="/home" label="Home" icon={<Home size={16} strokeWidth={1.75} />} expanded={expanded} />
      <NavItem to="/library" label="Library" icon={<Images size={16} strokeWidth={1.75} />} expanded={expanded} />
      <NavItem to="/settings" label="Settings" icon={<Settings size={16} strokeWidth={1.75} />} expanded={expanded} />

      <div className="g-nav-foot">
        <ToggleItem expanded={expanded} onClick={toggle} />
      </div>
    </nav>
  );
}

/* ─── NavItem ─────────────────────────────────────────────────────────── */
interface NavItemProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  expanded: boolean;
}

function NavItem({ to, label, icon, expanded }: NavItemProps) {
  const link = (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) =>
        isActive ? "g-nav-item g-nav-item--active" : "g-nav-item"
      }
    >
      <span className="g-nav-icon">{icon}</span>
      <span className="g-nav-label">{label}</span>
    </NavLink>
  );
  // A visible label makes the tooltip redundant; only wrap while collapsed.
  return expanded ? link : <Tooltip label={label} side="right">{link}</Tooltip>;
}

/* ─── ToggleItem ──────────────────────────────────────────────────────── */
/** Bottom-anchored expand/collapse control. Mirrors NavItem's row layout. */
function ToggleItem({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const label = expanded ? "Collapse" : "Expand";
  const btn = (
    <button
      type="button"
      className="g-nav-item g-nav-toggle"
      aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span className="g-nav-icon">
        {expanded
          ? <ChevronsLeft size={16} strokeWidth={1.75} />
          : <ChevronsRight size={16} strokeWidth={1.75} />}
      </span>
      <span className="g-nav-label">{label}</span>
    </button>
  );
  return expanded ? btn : <Tooltip label="Expand sidebar" side="right">{btn}</Tooltip>;
}
