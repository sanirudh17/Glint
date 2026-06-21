import { useState } from "react";
import { General }    from "./settings/General";
import { Capture }    from "./settings/Capture";
import { Recording }  from "./settings/Recording";
import { AutoSave }   from "./settings/AutoSave";
import { Hotkeys }    from "./settings/Hotkeys";
import { Appearance } from "./settings/Appearance";
import { Storage }    from "./settings/Storage";
import "./settings.css";


// ─── Sub-nav definition ───────────────────────────────────────────────────────

type SectionId =
  | "general"
  | "capture"
  | "recording"
  | "autosave"
  | "hotkeys"
  | "appearance"
  | "storage";

interface NavItem {
  id: SectionId;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general",    label: "General" },
  { id: "capture",    label: "Capture" },
  { id: "recording",  label: "Recording" },
  { id: "autosave",   label: "Auto-save" },
  { id: "hotkeys",    label: "Hotkeys" },
  { id: "appearance", label: "Appearance" },
  { id: "storage",    label: "Storage" },
];

// ─── Section panel map ────────────────────────────────────────────────────────

const PANELS: Record<SectionId, React.ReactNode> = {
  general:    <General />,
  capture:    <Capture />,
  recording:  <Recording />,
  autosave:   <AutoSave />,
  hotkeys:    <Hotkeys />,
  appearance: <Appearance />,
  storage:    <Storage />,
};

// ─── View ─────────────────────────────────────────────────────────────────────

export default function SettingsView() {
  const [active, setActive] = useState<SectionId>("appearance");

  return (
    <div className="settings-view">
      {/* ── Left sub-nav ──────────────────────────────────────────────── */}
      <nav className="settings-nav" aria-label="Settings sections">
        <span className="label settings-nav-eyebrow">Settings</span>
        <ul className="settings-nav-list" role="list">
          {NAV_ITEMS.map(({ id, label }) => (
            <li key={id}>
              <button
                type="button"
                className={[
                  "settings-nav-item",
                  active === id ? "settings-nav-item--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={active === id ? "page" : undefined}
                onClick={() => setActive(id)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── Right content panel ───────────────────────────────────────── */}
      <div className="settings-panel" role="region" aria-label={active}>
        {PANELS[active]}
      </div>
    </div>
  );
}
