import { useCallback, useRef, useState } from "react";
import { ExternalLink, FolderOpen, Copy, Pencil, PenLine, Pin, Trash2, Play, Scissors, ScanText, Tag, Image as ImageIcon, Video } from "lucide-react";
import { CaptureMenu, type CaptureAction } from "./CaptureMenu";
import { emit } from "@tauri-apps/api/event";
import type { CaptureItem } from "../../lib/captures";
import { openCapture, revealCapture, copyCapture, copyCapturePath, deleteCapture, renameCapture, dragOut } from "../../lib/captures";
import { openTrim } from "../../lib/trim";
import { openEditorCapture } from "../../lib/editor";
import { pinCreateFromCapture } from "../../lib/pin";
import { extractCapture } from "../../lib/ocr";
import { useAppStore } from "../../store/useAppStore";
// Card styles live in library.css; import here so the card is styled wherever
// it's used (the Library grid *and* the Home dashboard's recent-captures row).
import "../library.css";

function when(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function CaptureCard({
  item,
  onChanged,
  variant = "library",
}: {
  item: CaptureItem;
  onChanged: () => void;
  variant?: "home" | "library";
}) {
  const pushToast = useAppStore((s) => s.pushToast);
  const isRecording = item.kind === "recording";
  const isGif=item.kind==='gif';

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  // Set on Escape so the blur that follows cancels instead of committing.
  const cancelRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{x:number;y:number}|null>(null);
  const closeMenu = useCallback(() => { setMenu(null); }, []);

  // Surface command failures (e.g. the file was deleted in Explorer) instead of
  // failing silently — the Rust side returns a human-readable message.
  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      pushToast(typeof e === "string" ? e : "Something went wrong");
    }
  }

  const startRename = () => {
    setDraft(item.title ?? "");
    cancelRef.current = false;
    setRenaming(true);
  };
  // ── Hover actions (appearance-only grouping; every action below already
  // existed on the card — nothing added, nothing removed) ──────────────────
  // Enter and click-away both blur → commit; Escape blurs with cancelRef set → skip.
  const finishRename = async () => {
    setRenaming(false);
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    const next = draft.trim();
    if (next !== (item.title ?? "")) {
      await act(async () => { await renameCapture(item.id, next); onChanged(); });
    }
  };
  const doCopyPath = () => act(async () => { await copyCapturePath(item.id); pushToast("Path copied"); });
  const doDelete = () => act(async () => { await deleteCapture(item.id); await emit("capture-saved"); onChanged(); });

  const shotGroups: CaptureAction[][] = [
    [
      { label: "Open in editor", icon: Pencil, run: () => act(() => openEditorCapture(item.id)) },
      { label: "Annotate", icon: PenLine, run: () => act(() => openEditorCapture(item.id)) },
      { label: "Copy image", icon: Copy, run: () => act(() => copyCapture(item.id)) },
      { label: "Pin to screen", icon: Pin, run: () => act(() => pinCreateFromCapture(item.id)) },
    ],
    [
      { label: "Rename", icon: Tag, run: startRename },
      { label: "Show in folder", icon: FolderOpen, run: () => act(() => revealCapture(item.id)) },
      { label: "Extract text", icon: ScanText, run: () => act(() => extractCapture(item.id)) },
      { label: "Open in default app", icon: ExternalLink, run: () => act(() => openCapture(item.id)) },
    ],
    [{ label: "Delete", icon: Trash2, danger: true, run: doDelete }],
  ];
  const recGroups: CaptureAction[][] = [
    [
      { label: "Open in default app", icon: ExternalLink, run: () => act(() => openCapture(item.id)) },
      { label: "Reveal in Explorer", icon: FolderOpen, run: () => act(() => revealCapture(item.id)) },
    ],
    [
      { label: "Trim", icon: Scissors, run: () => act(() => openTrim(item.id, item.path)) },
      { label: "Rename", icon: Tag, run: startRename },
    ],
    [{ label: "Copy file", icon: Copy, run: () => act(() => copyCapture(item.id)) },{ label: "Copy file path", icon: Copy, run: doCopyPath }],
    [{ label: "Delete", icon: Trash2, danger: true, run: doDelete }],
  ];
  const gifGroups:CaptureAction[][]=[[
    {label:'Open GIF',icon:ExternalLink,run:()=>act(()=>openCapture(item.id))},
    {label:'Copy GIF file',icon:Copy,run:()=>act(()=>copyCapture(item.id))},
    {label:'Reveal in Explorer',icon:FolderOpen,run:()=>act(()=>revealCapture(item.id))},
    {label:'Rename',icon:Tag,run:startRename},
    {label:'Copy file path',icon:Copy,run:doCopyPath},
    {label:'Delete',icon:Trash2,danger:true,run:doDelete},
  ]];

  return (
    <>
    <div
      ref={cardRef}
      className="cap-card"
      data-variant={variant}
      tabIndex={0}
      aria-label={item.title ?? `${isRecording ? "Recording" : "Screenshot"}, ${item.width} by ${item.height}`}
      aria-haspopup="menu"
      onContextMenu={event => { event.preventDefault(); if (!renaming) setMenu({x:event.clientX,y:event.clientY}); }}
      onKeyDown={event => {
        if (renaming) return;
        if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
          event.preventDefault(); const rect=event.currentTarget.getBoundingClientRect(); setMenu({x:rect.left+12,y:rect.top+30});
        }
      }}
      role="listitem"
      onPointerDown={event => { if (event.button === 0 && !renaming) void dragOut(item.path); }}
      title="Right-click for actions. Drag to share."
    >
      <div className="cap-thumb">
        {item.thumb_url ? (
          <img src={item.thumb_url} alt="" draggable={false} />
        ) : (
          <div className="cap-thumb--empty" />
        )}
        {isRecording && (
          <div className="cap-thumb-play">
            <Play size={24} strokeWidth={1.5} />
          </div>
        )}

      </div>

      <div className="cap-meta">
        {isRecording
          ? <Video className="cap-kind" size={14} strokeWidth={1.5} aria-label="Recording" />
          : <ImageIcon className="cap-kind" size={14} strokeWidth={1.5} aria-label="Screenshot" />}
        <div className="cap-text">
          {renaming ? (
            <input
              className="cap-rename-input"
              autoFocus
              value={draft}
              placeholder="Name this capture…"
              onChange={(e) => setDraft(e.currentTarget.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") { cancelRef.current = true; e.currentTarget.blur(); }
              }}
              onBlur={() => void finishRename()}
            />
          ) : item.title ? (
            <span className="cap-title" title={item.title}>
              {item.title}
            </span>
          ) : <span className="cap-title cap-title--dimensions">{item.width && item.height ? `${item.width}×${item.height}` : "—"}</span>}
          <span className="cap-sub">
            {(item.title || renaming) && <>{item.width && item.height ? `${item.width}×${item.height}` : "—"}<span className="cap-sub-sep" aria-hidden="true">·</span></>}
            {when(item.created_at)}
          </span>
        </div>
      </div>
    </div>
    {menu && <CaptureMenu {...menu} title={item.title ?? `${item.width} x ${item.height}`}
      groups={isGif ? gifGroups : isRecording ? recGroups : shotGroups} onClose={closeMenu} />}
    </>
  );
}
