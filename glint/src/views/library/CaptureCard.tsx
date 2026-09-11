import { useRef, useState } from "react";
import { ExternalLink, FolderOpen, Copy, Pencil, Pin, Trash2, Play, Scissors, ScanText, Tag, Image as ImageIcon, Video, type LucideIcon } from "lucide-react";
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
  /** "home" = centered compact overlay (Copy · Annotate · Pin); "library" =
   * bottom-aligned pill with the full divider-grouped action set. */
  variant?: "home" | "library";
}) {
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
  interface CardAct {
    label: string;
    icon: LucideIcon;
    danger?: boolean;
    run: () => void;
  }
  const doCopyPath = () => act(async () => { await copyCapturePath(item.id); pushToast("Path copied"); });
  const doDelete = () => act(async () => { await deleteCapture(item.id); onChanged(); });

  // Library pill: the full set, divider-grouped.
  const shotGroups: CardAct[][] = [
    [
      { label: "Copy", icon: Copy, run: () => act(() => copyCapture(item.id)) },
      { label: "Reveal in Explorer", icon: FolderOpen, run: () => act(() => revealCapture(item.id)) },
    ],
    [
      { label: "Annotate", icon: Pencil, run: () => act(() => openEditorCapture(item.id)) },
      { label: "Extract text", icon: ScanText, run: () => act(() => extractCapture(item.id)) },
    ],
    [
      { label: "Open", icon: ExternalLink, run: () => act(() => openCapture(item.id)) },
      { label: "Pin to screen", icon: Pin, run: () => act(() => pinCreateFromCapture(item.id)) },
    ],
    [{ label: "Rename", icon: Tag, run: startRename }],
    [{ label: "Delete", icon: Trash2, danger: true, run: doDelete }],
  ];
  const recGroups: CardAct[][] = [
    [
      { label: "Open", icon: ExternalLink, run: () => act(() => openCapture(item.id)) },
      { label: "Reveal in Explorer", icon: FolderOpen, run: () => act(() => revealCapture(item.id)) },
    ],
    [
      { label: "Trim", icon: Scissors, run: () => act(() => openTrim(item.id, item.path)) },
      { label: "Rename", icon: Tag, run: startRename },
    ],
    [{ label: "Copy file path", icon: Copy, run: doCopyPath }],
    [{ label: "Delete", icon: Trash2, danger: true, run: doDelete }],
  ];
  // Home overlay: compact primary trio (the full set lives in Library).
  const homeActs: CardAct[] = isRecording
    ? [
        { label: "Copy file path", icon: Copy, run: doCopyPath },
        { label: "Trim", icon: Scissors, run: () => act(() => openTrim(item.id, item.path)) },
        { label: "Pin to screen", icon: Pin, run: () => act(() => pinCreateFromCapture(item.id)) },
      ]
    : [
        { label: "Copy", icon: Copy, run: () => act(() => copyCapture(item.id)) },
        { label: "Annotate", icon: Pencil, run: () => act(() => openEditorCapture(item.id)) },
        { label: "Pin to screen", icon: Pin, run: () => act(() => pinCreateFromCapture(item.id)) },
      ];

  const renderBtn = (a: CardAct) => {
    const Icon = a.icon;
    return (
      <button
        key={a.label}
        type="button"
        className={`cap-btn${a.danger ? " cap-btn--danger" : ""}`}
        aria-label={a.label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={a.run}
      >
        <Icon size={16} strokeWidth={1.5} />
        <span className="cap-tip" aria-hidden="true">{a.label}</span>
      </button>
    );
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
            <Play size={24} strokeWidth={1.5} />
          </div>
        )}
        {variant === "home" ? (
          <div className="cap-hover" onPointerDown={(e) => e.stopPropagation()}>
            {homeActs.map(renderBtn)}
          </div>
        ) : (
          <div className="cap-actions" onPointerDown={(e) => e.stopPropagation()}>
            {(isRecording ? recGroups : shotGroups).map((group, gi) => (
              <span className="cap-group" key={gi} role="group">
                {group.map(renderBtn)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="cap-meta">
        <span className="cap-name">
          {isRecording
            ? <Video className="cap-kind" size={13} strokeWidth={1.5} aria-label="Recording" />
            : <ImageIcon className="cap-kind" size={13} strokeWidth={1.5} aria-label="Screenshot" />}
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
    </div>
  );
}
