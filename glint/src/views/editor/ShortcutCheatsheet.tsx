import { SHORTCUTS } from "../../editor/shortcuts";

/** Modal cheatsheet listing every editor shortcut. Rendered by EditorView; opens
 *  on `?`, closes on backdrop click or Esc (handled by the parent). */
export function ShortcutCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="editor-cheatsheet-backdrop" onClick={onClose}>
      <div className="editor-cheatsheet" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="editor-cheatsheet-title">Keyboard shortcuts</div>
        <div className="editor-cheatsheet-cols">
          {SHORTCUTS.map((g) => (
            <div key={g.title} className="editor-cheatsheet-group">
              <div className="editor-cheatsheet-group-title">{g.title}</div>
              {g.items.map((i) => (
                <div key={i.keys + i.label} className="editor-cheatsheet-row">
                  <kbd className="editor-cheatsheet-kbd">{i.keys}</kbd>
                  <span>{i.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
