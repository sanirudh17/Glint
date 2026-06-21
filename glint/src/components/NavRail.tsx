import { useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Home, Images, Settings } from "lucide-react";
import { Tooltip } from "./ui";

/**
 * NavRail — vertical icon navigation.
 *
 * Active state: accent icon color + accent-subtle fill + 3px left-edge bar
 * (implemented in shell.css via ::before pseudo-element).
 *
 * Also subscribes to the Rust `navigate` event so the tray "Settings" menu
 * item can route the frontend without the user clicking in the window.
 */
export function NavRail() {
  const navigate = useNavigate();

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
    <nav className="g-nav-rail" aria-label="Main navigation">
      <NavItem to="/home" label="Home" icon={<Home size={16} strokeWidth={1.75} />} />
      <NavItem to="/library" label="Library" icon={<Images size={16} strokeWidth={1.75} />} />
      <NavItem to="/settings" label="Settings" icon={<Settings size={16} strokeWidth={1.75} />} />
    </nav>
  );
}

/* ─── NavItem ─────────────────────────────────────────────────────────── */
interface NavItemProps {
  to: string;
  label: string;
  icon: React.ReactNode;
}

function NavItem({ to, label, icon }: NavItemProps) {
  return (
    <Tooltip label={label}>
      <NavLink
        to={to}
        aria-label={label}
        className={({ isActive }) =>
          isActive ? "g-nav-item g-nav-item--active" : "g-nav-item"
        }
      >
        {icon}
      </NavLink>
    </Tooltip>
  );
}
