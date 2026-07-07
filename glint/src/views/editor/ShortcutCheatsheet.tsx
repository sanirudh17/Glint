import { SHORTCUTS } from "../../editor/shortcuts";

/** Modal cheatsheet listing every editor shortcut in one scrollable column.
 *  Rendered by EditorView; opens on `?`, closes on backdrop click, the ✕, or Esc
 *  (Esc handled by the parent). */
export function ShortcutCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="editor-cheatsheet-backdrop" onClick={onClose}>
      <div
        className="editor-cheatsheet"
        role="dialog"
        aria-label="Keyboard shortcuts"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="editor-cheatsheet-head">
          <span className="editor-cheatsheet-title">Keyboard shortcuts</span>
          <button className="editor-cheatsheet-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <kbd>Esc</kbd>
          </button>
        </header>
        <div className="editor-cheatsheet-body">
          {SHORTCUTS.map((g) => (
            <section key={g.title} className="editor-cheatsheet-group">
              <div className="editor-cheatsheet-group-title">{g.title}</div>
              <ul className="editor-cheatsheet-list">
                {g.items.map((i) => (
                  <li key={i.keys + i.label} className="editor-cheatsheet-row">
                    <span className="editor-cheatsheet-label">{i.label}</span>
                    <kbd className="editor-cheatsheet-kbd">{i.keys}</kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
