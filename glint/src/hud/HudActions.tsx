/**
 * HudActions.tsx — the hover toolbar of the post-capture HUD.
 *
 * One horizontal icon-only dock: a dark translucent pill with 1px hairline
 * dividers grouping [Copy | Copy path] · [Save/Reveal] · [Annotate | Extract] ·
 * [Pin]. Dismiss lives on the card corner (the 208px card cannot fit a seventh
 * 30px target). Each button stops pointer-down propagation so clicking it never
 * starts a drag-out. Tooltips are instant CSS chips — no delay, no animation.
 */
import {
  Copy,
  Link2,
  Save,
  FolderOpen,
  Pencil,
  Pin,
  ScanText,
  type LucideIcon,
} from "lucide-react";

export type HudAction =
  | "copy"
  | "copy-path"
  | "save"
  | "annotate"
  | "extract-text"
  | "pin"
  | "dismiss";

interface ButtonDef {
  id: Exclude<HudAction, "dismiss">;
  icon: LucideIcon;
  tip: string;
}

export function HudActions({
  onAction,
  saved,
}: {
  onAction: (a: HudAction) => void;
  saved: boolean;
}) {
  // When the capture was auto-saved, the Save slot becomes Reveal-in-folder.
  // Groups mirror the CleanShot dock: divider-separated, never nested.
  const groups: ButtonDef[][] = [
    [
      { id: "copy",      icon: Copy,  tip: "Copy image" },
      { id: "copy-path", icon: Link2, tip: "Copy path" },
    ],
    [
      saved
        ? { id: "save", icon: FolderOpen, tip: "Reveal in folder" }
        : { id: "save", icon: Save,       tip: "Save to Library" },
    ],
    [
      { id: "annotate",    icon: Pencil,   tip: "Annotate" },
      { id: "extract-text", icon: ScanText, tip: "Extract text" },
    ],
    [
      { id: "pin", icon: Pin, tip: "Pin" },
    ],
  ];
  return (
    <div className="hud-toolbar" role="toolbar" aria-label="Capture actions">
      {groups.map((group, gi) => (
        <span className="hud-toolgroup" key={gi} role="group">
          {group.map(({ id, icon: Icon, tip }) => (
            <button
              key={id}
              type="button"
              className="hud-btn"
              aria-label={tip}
              // Don't let a button press initiate a thumbnail drag.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onAction(id)}
            >
              <Icon size={16} strokeWidth={1.5} />
              <span className="hud-tip" aria-hidden="true">{tip}</span>
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}
