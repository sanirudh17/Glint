/**
 * HudActions.tsx — the hover toolbar of the post-capture HUD.
 *
 * Five iconographic, instrument-grade actions that reveal over the bottom of the
 * thumbnail on hover. Dismiss is a separate corner button on the card itself.
 * Annotate + Pin are honest stubs until P5 / P7. Each button stops pointer-down
 * propagation so clicking it never starts a drag-out.
 */
import {
  Copy,
  Link2,
  Save,
  Pencil,
  Pin,
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
  id: Exclude<HudAction, "dismiss">;
  icon: LucideIcon;
  tip: string;
}

const ACTIONS: ButtonDef[] = [
  { id: "copy",      icon: Copy,   tip: "Copy image" },
  { id: "copy-path", icon: Link2,  tip: "Copy path" },
  { id: "save",      icon: Save,   tip: "Save" },
  { id: "annotate",  icon: Pencil, tip: "Annotate" },
  { id: "pin",       icon: Pin,    tip: "Pin" },
];

export function HudActions({ onAction }: { onAction: (a: HudAction) => void }) {
  return (
    <div className="hud-toolbar">
      {ACTIONS.map(({ id, icon: Icon, tip }) => (
        <button
          key={id}
          type="button"
          className="hud-btn"
          data-tip={tip}
          aria-label={tip}
          // Don't let a button press initiate a thumbnail drag.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onAction(id)}
        >
          <Icon size={16} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
