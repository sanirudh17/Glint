import { useRef, useState } from "react";
import { ExternalLink, FolderOpen, Copy, Pencil, Pin, Trash2, Play, Scissors, ScanText, Tag, Image as ImageIcon, Video } from "lucide-react";
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

export function CaptureCard({ item, onChanged }: { item: CaptureItem; onChanged: () => void }) {
  const pushToast = useAppStore((s) => s.pushToast);
  const isRecording = item.kind === "recording";

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  // Set on Escape so the blur that follows cancels instead of committing.
  const cancelRef = useRef(false);

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

  return (
    <div
      className="cap-card"
      role="listitem"
      onPointerDown={() => dragOut(item.path)}
      title="Drag to share"
    >
      <div className="cap-thumb">
        {item.thumb_url ? (
          <img src={item.thumb_url} alt="" draggable={false} />
        ) : (
          <div className="cap-thumb--empty" />
        )}
        {isRecording && (
          <div className="cap-thumb-play">
            <Play size={24} strokeWidth={1.75} />
          </div>
        )}
      </div>

      <div className="cap-meta">
        <span className="cap-name">
          {isRecording
            ? <Video className="cap-kind" size={13} strokeWidth={1.75} aria-label="Recording" />
            : <ImageIcon className="cap-kind" size={13} strokeWidth={1.75} aria-label="Screenshot" />}
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
          ) : (
            <span className="cap-dims" title={item.title ?? undefined}>
              {item.title ? item.title : item.width && item.height ? `${item.width}×${item.height}` : "—"}
            </span>
          )}
        </span>
        <span className="cap-when">{when(item.created_at)}</span>
      </div>

      <div className="cap-actions" onPointerDown={(e) => e.stopPropagation()}>
        {isRecording ? (
          <>
            <button className="cap-btn" aria-label="Open" title="Open" onClick={() => act(() => openCapture(item.id))}>
              <ExternalLink size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Reveal in Explorer" title="Reveal" onClick={() => act(() => revealCapture(item.id))}>
              <FolderOpen size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Trim" title="Trim" onClick={() => act(() => openTrim(item.id, item.path))}>
              <Scissors size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Rename" title="Rename" onClick={startRename}>
              <Tag size={15} strokeWidth={1.75} />
            </button>
            <button
              className="cap-btn"
              aria-label="Copy file path"
              title="Copy file path"
              onClick={() => act(async () => { await copyCapturePath(item.id); pushToast("Path copied"); })}
            >
              <Copy size={15} strokeWidth={1.75} />
            </button>
            <button
              className="cap-btn cap-btn--danger"
              aria-label="Delete"
              title="Delete"
              onClick={() => act(async () => { await deleteCapture(item.id); onChanged(); })}
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          </>
        ) : (
          <>
            <button className="cap-btn" aria-label="Open" title="Open" onClick={() => act(() => openCapture(item.id))}>
              <ExternalLink size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Reveal in Explorer" title="Reveal" onClick={() => act(() => revealCapture(item.id))}>
              <FolderOpen size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Edit" title="Edit" onClick={() => act(() => openEditorCapture(item.id))}>
              <Pencil size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Rename" title="Rename" onClick={startRename}>
              <Tag size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Extract text" title="Extract text" onClick={() => act(() => extractCapture(item.id))}>
              <ScanText size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Copy" title="Copy" onClick={() => act(() => copyCapture(item.id))}>
              <Copy size={15} strokeWidth={1.75} />
            </button>
            <button className="cap-btn" aria-label="Pin to screen" title="Pin to screen" onClick={() => act(() => pinCreateFromCapture(item.id))}>
              <Pin size={15} strokeWidth={1.75} />
            </button>
            <button
              className="cap-btn cap-btn--danger"
              aria-label="Delete"
              title="Delete"
              onClick={() => act(async () => { await deleteCapture(item.id); onChanged(); })}
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
