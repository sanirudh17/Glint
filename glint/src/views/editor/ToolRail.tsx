import {
  MousePointer2, ArrowUpRight, Minus, Square, Circle as CircleIcon,
  Type, Pen, Highlighter, Droplet, Hash, Eraser, Crop as CropIcon, Undo2, Redo2, Trash2, type LucideIcon,
} from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import type { ToolId } from "../../editor/model";

const TOOLS: { id: ToolId; icon: LucideIcon; tip: string; key: string }[] = [
  { id: "select",    icon: MousePointer2, tip: "Select (V)",      key: "V" },
  { id: "arrow",     icon: ArrowUpRight,  tip: "Arrow (A)",       key: "A" },
  { id: "line",      icon: Minus,         tip: "Line (L)",        key: "L" },
  { id: "rect",      icon: Square,        tip: "Rectangle (R)",   key: "R" },
  { id: "ellipse",   icon: CircleIcon,    tip: "Ellipse (O)",     key: "O" },
  { id: "text",      icon: Type,          tip: "Text (T)",        key: "T" },
  { id: "pen",       icon: Pen,           tip: "Pen (P)",         key: "P" },
  { id: "highlight", icon: Highlighter,   tip: "Highlighter (H)", key: "H" },
  { id: "blur",      icon: Droplet,       tip: "Blur (B)",        key: "B" },
  { id: "step",      icon: Hash,          tip: "Step (S)",        key: "S" },
  { id: "eraser",    icon: Eraser,        tip: "Eraser (E)",      key: "E" },
  { id: "crop",      icon: CropIcon,      tip: "Crop (C)",        key: "C" },
];

export function ToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const clearAll = useEditorStore((s) => s.clearAll);
  const hasAnnotations = useEditorStore((s) => s.annotations.length > 0);

  return (
    <div className="editor-rail" role="toolbar" aria-label="Annotation tools">
      {TOOLS.map(({ id, icon: Icon, tip }) => (
        <button
          key={id}
          className={`editor-tool${tool === id ? " editor-tool--active" : ""}`}
          title={tip}
          aria-label={tip}
          aria-pressed={tool === id}
          onClick={() => setTool(id)}
        >
          <Icon size={18} strokeWidth={1.75} />
        </button>
      ))}
      <div className="editor-rail-sep" />
      <button className="editor-tool" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => undo()}>
        <Undo2 size={18} strokeWidth={1.75} />
      </button>
      <button className="editor-tool" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => redo()}>
        <Redo2 size={18} strokeWidth={1.75} />
      </button>
      <button
        className="editor-tool editor-tool--danger"
        title="Clear all annotations"
        aria-label="Clear all annotations"
        disabled={!hasAnnotations}
        onClick={() => clearAll()}
      >
        <Trash2 size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}
