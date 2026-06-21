/**
 * DragTest.tsx — SPIKE (throwaway, P3 drag de-risk).
 *
 * Confirms tauri-plugin-drag can drag a REAL temp PNG out of the Glint window
 * into another Windows app (Explorer, Slack, a file field). The architecture
 * doc flagged Windows drag-out as a "known rough edge"; this proves the exact
 * plugin + OS path the post-capture HUD will rely on before we build the HUD.
 *
 * Flow: on mount, ask Rust to write a known gradient PNG to the temp dir and
 * return its absolute path. Pressing the tile calls startDrag with that path;
 * the OS takes over the drag. The callback reports Dropped / Cancelled.
 *
 * DELETE this file, the /dragtest route, and the spike_make_test_png command
 * once the drag-out path is proven and folded into the real HUD.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

export function DragTest() {
  const [path, setPath] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("spike_make_test_png")
      .then(setPath)
      .catch((e) => setErr(String(e)));
  }, []);

  async function onDrag() {
    if (!path) return;
    setStatus("dragging…");
    try {
      await startDrag({ item: [path], icon: path, mode: "copy" }, (r) => {
        setStatus(`callback: ${r.result} @ (${r.cursorPos.x}, ${r.cursorPos.y})`);
      });
    } catch (e) {
      setErr(String(e));
      setStatus("error");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        background: "#0b0d12",
        color: "#e8eaf0",
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
        Drag-out spike
      </h1>
      <p style={{ fontSize: 13, color: "#9aa0ac", maxWidth: 420, textAlign: "center", margin: 0 }}>
        Press and hold the tile below, then drag into Explorer, the desktop, or a
        chat app. It should drop <code>glint-dragtest.png</code> as a real file.
      </p>

      {/* The draggable tile. mousedown starts the OS drag immediately. */}
      <div
        onMouseDown={onDrag}
        style={{
          width: 240,
          height: 150,
          borderRadius: 12,
          cursor: "grab",
          // Mirror the generated PNG's gradient so the tile reads as the file.
          background: "linear-gradient(135deg, #000 0%, #5B7CFA 100%)",
          border: "1px solid rgba(255,255,255,0.14)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 500,
          boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
        }}
      >
        ⤴ Drag me out
      </div>

      <div style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "#9aa0ac" }}>
        status: <span style={{ color: "#e8eaf0" }}>{status}</span>
      </div>
      <div style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#5c6270", maxWidth: 520, wordBreak: "break-all", textAlign: "center" }}>
        {err ? <span style={{ color: "#ff6b6b" }}>error: {err}</span> : (path ?? "writing test png…")}
      </div>
    </div>
  );
}
