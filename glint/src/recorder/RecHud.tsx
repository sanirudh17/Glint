/**
 * RecHud.tsx — the post-recording HUD (route #/rec-hud).
 *
 * Mirrors the screenshot HUD (HudApp): a compact thumbnail card parked bottom-left
 * that IS the drag handle. Quiet by default — just the video preview with a play
 * badge and viewfinder ticks. On hover, a scrim + a small action toolbar reveal
 * over the bottom edge (Open · Reveal · Copy path) and a close button appears
 * top-right. Reuses the screenshot HUD's styles so the two feel identical.
 *
 * Recorder-owned: it invokes the generic Library commands by id and the shared
 * file-drag helper — it pulls in no capture/editor UI.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, FolderOpen, Copy, X, Play } from "lucide-react";
import { dragOut } from "../lib/hudIpc";
import "../hud/hud.css";
import "./recorder.css";

type RecHudData = { id: number; path: string; thumb_data_url: string | null };

export function RecHud() {
  const [data, setData] = useState<RecHudData | null>(null);

  useEffect(() => {
    invoke<RecHudData | null>("rec_hud_data")
      .then((d) => { if (d) setData(d); else invoke("rec_hud_dismiss").catch(() => {}); })
      .catch(() => {});
  }, []);

  const dismiss = () => { invoke("rec_hud_dismiss").catch(() => {}); };
  const act = (cmd: string) => { if (data) invoke(cmd, { id: data.id }).catch(() => {}); };

  return (
    <div className="hud-root">
      <div className={`hud-card${data ? "" : " hud-card--loading"}`}>
        {/* Drag surface — the thumbnail; sits beneath the overlays so toolbar /
            close clicks never start a drag-out. */}
        <div
          className="hud-drag"
          onPointerDown={() => data && dragOut(data.path)}
          role="img"
          aria-label="Recording — drag to share"
          title="Drag to share"
        >
          {data?.thumb_data_url && (
            <img className="hud-thumb-img" src={data.thumb_data_url} alt="" draggable={false} />
          )}
        </div>

        {/* Play badge — marks this as a video; fades on hover like the ticks. */}
        <span className="rec-hud-play-badge" aria-hidden>
          <Play size={20} strokeWidth={2} fill="currentColor" />
        </span>

        {/* Viewfinder corner ticks. */}
        <span className="hud-tick hud-tick--tl" />
        <span className="hud-tick hud-tick--tr" />
        <span className="hud-tick hud-tick--bl" />
        <span className="hud-tick hud-tick--br" />

        <button
          type="button"
          className="hud-close"
          aria-label="Dismiss"
          title="Dismiss"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={dismiss}
        >
          <X size={13} strokeWidth={2} />
        </button>

        {/* Scrim + action toolbar — revealed on hover. */}
        <div className="hud-scrim" aria-hidden="true" />
        <div className="hud-toolbar">
          <button className="hud-btn" title="Open" aria-label="Open" onPointerDown={(e) => e.stopPropagation()} onClick={() => act("capture_open")}>
            <ExternalLink size={16} strokeWidth={1.75} />
          </button>
          <button className="hud-btn" title="Reveal in Explorer" aria-label="Reveal" onPointerDown={(e) => e.stopPropagation()} onClick={() => act("capture_reveal")}>
            <FolderOpen size={16} strokeWidth={1.75} />
          </button>
          <button className="hud-btn" title="Copy file path" aria-label="Copy path" onPointerDown={(e) => e.stopPropagation()} onClick={() => act("capture_copy_path")}>
            <Copy size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
