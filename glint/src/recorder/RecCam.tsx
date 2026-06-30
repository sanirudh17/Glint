/** RecCam.tsx — webcam bubble (route #/rec-cam): draggable, S/M/L, un-mirrored. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Maximize2, X } from "lucide-react";
import "./reccam.css";

const SIZES = [120, 170, 230]; // S / M / L diameter (logical px); index 1 = default

export function RecCam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [sizeIdx, setSizeIdx] = useState(1);

  useEffect(() => {
    // Do NOT register onCloseRequested here. @tauri-apps/api's onCloseRequested
    // defers the window teardown to this webview's JS handshake, which is unreliable
    // for this transparent/focus-less bubble — it left the window lingering after
    // stop and broke re-enabling (build_cam_bubble early-returns while the label
    // still exists). The recorder tears this window down with destroy() instead.
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((s) => {
        // Resolves only AFTER the user grants the WebView2 camera prompt, so this
        // is the signal recorder_start waits on before starting the countdown.
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        emit("rec-cam-ready").catch(() => {});
      })
      .catch(() => {
        emit("rec-cam-failed").catch(() => {}); // unblock recorder_start's wait
        emit("glint-toast", "Camera unavailable").catch(() => {});
        getCurrentWindow().destroy().catch(() => {});
      });
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Cycle S→M→L: resize the window, keeping the bottom-right corner anchored so
  // the bubble doesn't drift off the recording area as it grows.
  async function cycleSize() {
    const next = (sizeIdx + 1) % SIZES.length;
    const win = getCurrentWindow();
    const cur = SIZES[sizeIdx];
    const dim = SIZES[next];
    const scale = await win.scaleFactor();
    const pos = await win.outerPosition(); // physical
    const delta = Math.round((dim - cur) * scale);
    await win.setSize(new LogicalSize(dim, dim));
    await win.setPosition(new PhysicalPosition(pos.x - delta, pos.y - delta));
    setSizeIdx(next);
  }

  // The ✕ must turn the webcam off THROUGH the recorder so the shared state and the
  // control-bar toggle both update — closing the window directly leaves webcam_on=true
  // (stale) and the enable toggle dead. recorder_set_webcam(false) destroys this bubble.
  // Stop the stream first (the invoke destroys this JS context before cleanup runs).
  function close() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    invoke("recorder_set_webcam", { on: false }).catch(() =>
      getCurrentWindow().destroy().catch(() => {}),
    );
  }

  // Press-drag anywhere on the bubble (but not the buttons) moves the window.
  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".reccam-btn")) return;
    getCurrentWindow().startDragging().catch(() => {});
  }

  return (
    <div className="reccam" onPointerDown={onPointerDown}>
      <video ref={videoRef} className="reccam-video" autoPlay muted playsInline />
      <div className="reccam-controls">
        <button className="reccam-btn" title="Resize" aria-label="Resize" onClick={cycleSize}>
          <Maximize2 size={13} strokeWidth={2} />
        </button>
        <button className="reccam-btn" title="Turn off webcam" aria-label="Turn off webcam" onClick={close}>
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
