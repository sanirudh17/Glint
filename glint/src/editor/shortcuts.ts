export interface ShortcutGroup {
  title: string;
  items: { keys: string; label: string }[];
}

/** Single documented source for editor shortcuts — mirrors EditorView's key map +
 *  actions. Keep this in sync with the handlers there. */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Tools",
    items: [
      { keys: "V", label: "Select" },
      { keys: "A", label: "Arrow" },
      { keys: "L", label: "Line" },
      { keys: "R", label: "Rectangle" },
      { keys: "O", label: "Ellipse" },
      { keys: "T", label: "Text" },
      { keys: "P", label: "Pen" },
      { keys: "H", label: "Highlighter" },
      { keys: "B", label: "Blur" },
      { keys: "K", label: "Redact" },
      { keys: "F", label: "Spotlight" },
      { keys: "S", label: "Step number" },
      { keys: "E", label: "Eraser" },
      { keys: "C", label: "Crop" },
      { keys: "I", label: "Eyedropper" },
    ],
  },
  {
    title: "Editing",
    items: [
      { keys: "Ctrl+Z", label: "Undo" },
      { keys: "Ctrl+Shift+Z", label: "Redo" },
      { keys: "Ctrl+D", label: "Duplicate selection" },
      { keys: "Del", label: "Delete selection" },
      { keys: "Arrows", label: "Nudge 1px" },
      { keys: "Shift+Arrows", label: "Nudge 10px" },
    ],
  },
  {
    title: "File",
    items: [
      { keys: "Ctrl+S", label: "Save project" },
      { keys: "?", label: "Show this cheatsheet" },
      { keys: "Esc", label: "Close / cancel" },
    ],
  },
];
