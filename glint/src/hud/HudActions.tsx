/**
 * HudActions.tsx — the action row of the post-capture HUD.
 *
 * Iconographic, instrument-grade buttons. Each carries a `data-tip` for the
 * CSS tooltip (hud.css). Annotate + Pin are stubs until P5 / P7 and announce
 * that inline. Dismiss is set slightly apart as the terminal action.
 */
import {
  Copy,
  Link2,
  Save,
  Pencil,
  Pin,
  X,
  type LucideIcon,
} from "lucide-react";

export type HudAction =
  | "copy"
  | "copy-path"
  | "save"
  | "annotate"
  | "pin"
  | "dismiss";

interface ButtonDef {
  id: HudAction;
  icon: LucideIcon;
  tip: string;
}

const PRIMARY: ButtonDef[] = [
  { id: "copy",      icon: Copy,   tip: "Copy image" },
  { id: "copy-path", icon: Link2,  tip: "Copy path" },
  { id: "save",      icon: Save,   tip: "Save to Pictures" },
  { id: "annotate",  icon: Pencil, tip: "Annotate" },
  { id: "pin",       icon: Pin,    tip: "Pin" },
];

export function HudActions({ onAction }: { onAction: (a: HudAction) => void }) {
  return (
    <div className="hud-actions">
      {PRIMARY.map(({ id, icon: Icon, tip }) => (
        <button
          key={id}
          type="button"
          className="hud-btn"
          data-tip={tip}
          aria-label={tip}
          onClick={() => onAction(id)}
        >
          <Icon size={17} strokeWidth={1.75} />
        </button>
      ))}

      <span className="hud-divider" aria-hidden="true" />

      <button
        type="button"
        className="hud-btn hud-btn--dismiss"
        data-tip="Dismiss"
        aria-label="Dismiss"
        onClick={() => onAction("dismiss")}
      >
        <X size={17} strokeWidth={1.75} />
      </button>
    </div>
  );
}
