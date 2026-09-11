/**
 * RecHud.tsx — the post-recording HUD (route #/rec-hud).
 *
 * Mirrors the screenshot HUD (HudApp): a compact thumbnail card parked bottom-left
 * that IS the drag handle. Quiet by default — just the video preview with a play
 * badge and viewfinder ticks. On hover, the action dock reveals over the bottom
 * edge ([Trim] · [Open | Reveal] · [Copy path]) and a close button appears
 * top-right. Reuses the screenshot HUD's styles so the two feel identical.
 *
 * Recorder-owned: it invokes the generic Library commands by id and the shared
 * file-drag helper — it pulls in no capture/editor UI.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, FolderOpen, Copy, X, Play, Scissors, type LucideIcon } from "lucide-react";
import { dragOut } from "../lib/hudIpc";
import { openTrim } from "../lib/trim";
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

  // Same dock language as the screenshot card: divider-grouped pill, instant
  // tooltips, no motion. [Trim] · [Open | Reveal] · [Copy path].
  const groups: { tip: string; icon: LucideIcon; run: () => void }[][] = [
    [{ tip: "Trim", icon: Scissors, run: () => data && openTrim(data.id, data.path) }],
    [
      { tip: "Open", icon: ExternalLink, run: () => act("capture_open") },
      { tip: "Reveal in Explorer", icon: FolderOpen, run: () => act("capture_reveal") },
    ],
    [{ tip: "Copy file path", icon: Copy, run: () => act("capture_copy_path") }],
  ];

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
          <X size={13} strokeWidth={1.5} />
        </button>

        {/* Action dock — revealed on hover. */}
        <div className="hud-toolbar" role="toolbar" aria-label="Recording actions">
          {groups.map((group, gi) => (
            <span className="hud-toolgroup" key={gi} role="group">
              {group.map(({ tip, icon: Icon, run }) => (
                <button
                  key={tip}
                  type="button"
                  className="hud-btn"
                  aria-label={tip}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={run}
                >
                  <Icon size={16} strokeWidth={1.5} />
                  <span className="hud-tip" aria-hidden="true">{tip}</span>
                </button>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
