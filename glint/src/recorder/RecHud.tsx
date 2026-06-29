/**
 * RecHud.tsx — the post-recording HUD (route #/rec-hud).
 *
 * A small floating card that appears bottom-left after a recording is saved,
 * showing the new video's thumbnail with quick actions: drag-out, Open (default
 * player), Reveal (Explorer), Copy path, and Dismiss. Mirrors the screenshot HUD.
 *
 * Recorder-owned: it invokes the generic Library commands by id (capture_open /
 * capture_reveal / capture_copy_path) and the shared file-drag helper — it pulls
 * in no capture/editor UI.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, FolderOpen, Copy, X, Play } from "lucide-react";
import { dragOut } from "../lib/hudIpc";
import "./recorder.css";

type RecHudData = { id: number; path: string; thumb_data_url: string | null };

export function RecHud() {
  const [data, setData] = useState<RecHudData | null>(null);

  useEffect(() => {
    invoke<RecHudData | null>("rec_hud_data").then(setData).catch(() => {});
  }, []);

  const dismiss = () => { invoke("rec_hud_dismiss").catch(() => {}); };
  const act = (cmd: string) => { if (data) invoke(cmd, { id: data.id }).catch(() => {}); };

  if (!data) return null;

  return (
    <div className="rec-hud">
      <div
        className="rec-hud-thumb"
        onPointerDown={() => dragOut(data.path)}
        title="Drag to share"
      >
        {data.thumb_data_url
          ? <img src={data.thumb_data_url} alt="" draggable={false} />
          : <div className="rec-hud-thumb--empty" />}
        <div className="rec-hud-play"><Play size={22} strokeWidth={1.75} /></div>
      </div>
      <div className="rec-hud-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button className="rec-hud-btn" title="Open" aria-label="Open" onClick={() => act("capture_open")}>
          <ExternalLink size={15} strokeWidth={1.75} />
        </button>
        <button className="rec-hud-btn" title="Reveal in Explorer" aria-label="Reveal" onClick={() => act("capture_reveal")}>
          <FolderOpen size={15} strokeWidth={1.75} />
        </button>
        <button className="rec-hud-btn" title="Copy file path" aria-label="Copy path" onClick={() => act("capture_copy_path")}>
          <Copy size={15} strokeWidth={1.75} />
        </button>
        <button className="rec-hud-btn" title="Dismiss" aria-label="Dismiss" onClick={dismiss}>
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
