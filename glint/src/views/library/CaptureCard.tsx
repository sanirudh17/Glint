import { ExternalLink, FolderOpen, Copy, Trash2 } from "lucide-react";
import type { CaptureItem } from "../../lib/captures";
import { openCapture, revealCapture, copyCapture, deleteCapture, dragOut } from "../../lib/captures";

function when(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function CaptureCard({ item, onChanged }: { item: CaptureItem; onChanged: () => void }) {
  async function act(fn: () => Promise<void>) {
    try { await fn(); } catch { /* non-fatal; Library stays as-is */ }
  }

  return (
    <div
      className="cap-card"
      role="listitem"
      onPointerDown={() => dragOut(item.path)}
      title="Drag to share"
    >
      <div className="cap-thumb">
        {item.thumb_data_url ? (
          <img src={item.thumb_data_url} alt="" draggable={false} />
        ) : (
          <div className="cap-thumb--empty" />
        )}
      </div>

      <div className="cap-meta">
        <span className="cap-dims">
          {item.width && item.height ? `${item.width}×${item.height}` : "—"}
        </span>
        <span className="cap-when">{when(item.created_at)}</span>
      </div>

      <div className="cap-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button className="cap-btn" aria-label="Open" title="Open" onClick={() => act(() => openCapture(item.id))}>
          <ExternalLink size={15} strokeWidth={1.75} />
        </button>
        <button className="cap-btn" aria-label="Reveal in Explorer" title="Reveal" onClick={() => act(() => revealCapture(item.id))}>
          <FolderOpen size={15} strokeWidth={1.75} />
        </button>
        <button className="cap-btn" aria-label="Copy" title="Copy" onClick={() => act(() => copyCapture(item.id))}>
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
      </div>
    </div>
  );
}
