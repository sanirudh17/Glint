/** RecCam.tsx — webcam bubble (route #/rec-cam): draggable, S/M/L, un-mirrored. In
 *  "movable" recordings the bubble also records its own camera stream to a .cam.webm
 *  sidecar via MediaRecorder, driven entirely by backend events so the track shares the
 *  screen capture's timeline. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Maximize2, X } from "lucide-react";
import "./reccam.css";

const SIZES = [120, 170, 230]; // S / M / L diameter (logical px); index 1 = default

export function RecCam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const firstChunkRef = useRef(true);
  const shapeRef = useRef<string>("circle"); // last shape read from settings (for the ready log)
  const [sizeIdx, setSizeIdx] = useState(1);
  const [shape, setShape] = useState<string>("circle");

  useEffect(() => {
    // Do NOT register onCloseRequested here. @tauri-apps/api's onCloseRequested
    // defers the window teardown to this webview's JS handshake, which is unreliable
    // for this transparent/focus-less bubble — it left the window lingering after
    // stop and broke re-enabling (build_cam_bubble early-returns while the label
    // still exists). The recorder tears this window down with destroy() instead.
    let cancelled = false;

    const attach = (s: MediaStream) => {
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      // Resolves only AFTER the user grants the WebView2 camera prompt, so this
      // is the signal recorder_start waits on before starting the countdown. The
      // payload also reports whether movable-mode recording (MediaRecorder/VP8) is
      // supported, so recorder_start can fall back to baked-in before capture.
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      const movableOk =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported("video/webm;codecs=vp8");
      emit("rec-cam-ready", { movableOk, shape: shapeRef.current }).catch(() => {});
    };

    // Cap at 720p: plenty for the bubble/overlay and keeps the streamed .cam.webm chunks
    // small over IPC in movable mode.
    const VIDEO_RES = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const openDefault = () =>
      navigator.mediaDevices.getUserMedia({ video: VIDEO_RES, audio: false }).then(attach);

    (async () => {
      // RecCam is its own window (no Zustand hydration) — read the chosen camera
      // straight from the backend settings.
      let deviceId = "";
      try {
        const s = await invoke<{ webcam_device_id?: string; webcam_shape?: string }>("settings_get_all");
        deviceId = s?.webcam_device_id ?? "";
        if (s?.webcam_shape) { setShape(s.webcam_shape); shapeRef.current = s.webcam_shape; }
      } catch {
        deviceId = "";
      }
      try {
        if (deviceId) {
          await navigator.mediaDevices
            .getUserMedia({ video: { deviceId: { exact: deviceId }, ...VIDEO_RES }, audio: false })
            .then(attach)
            .catch(async () => {
              // Saved camera unplugged/unavailable — fall back to the default.
              emit("glint-toast", "Saved camera unavailable — using default").catch(() => {});
              await openDefault();
            });
        } else {
          await openDefault();
        }
      } catch {
        emit("rec-cam-failed").catch(() => {}); // unblock recorder_start's wait
        emit("glint-toast", "Camera unavailable").catch(() => {});
        getCurrentWindow().destroy().catch(() => {});
      }
    })();

    // ── Movable-mode recording: driven by backend events so the .cam.webm shares the
    // screen capture's timeline. Chunks stream to disk as they arrive (flat memory). ──
    const startCamRecording = (path: string, stream: MediaStream) => {
      firstChunkRef.current = true;
      let mr: MediaRecorder;
      try {
        mr = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      } catch {
        // Unexpected: support was probed up front (rec-cam-ready.movableOk). Unblock a
        // pending stop and toast — the screen is already recording cleanly without a cam.
        emit("glint-toast", "Webcam recording failed").catch(() => {});
        emit("rec-cam-record-saved").catch(() => {});
        return;
      }
      mr.ondataavailable = async (e) => {
        if (!e.data || e.data.size === 0) return;
        const bytes = Array.from(new Uint8Array(await e.data.arrayBuffer()));
        const first = firstChunkRef.current;
        firstChunkRef.current = false;
        invoke("recorder_cam_write_chunk", { path, bytes, first }).catch(() => {
          emit("glint-toast", "Webcam recording error").catch(() => {});
        });
      };
      mr.onstop = () => emit("rec-cam-record-saved").catch(() => {});
      mrRef.current = mr;
      mr.start(1000); // 1s timeslice → periodic flushes
    };

    const offs: Array<() => void> = [];
    listen<{ path: string }>("rec-cam-record-start", (e) => {
      if (streamRef.current && !cancelled) startCamRecording(e.payload.path, streamRef.current);
    }).then((f) => offs.push(f)).catch(() => {});
    listen("rec-cam-record-pause", () => {
      if (mrRef.current?.state === "recording") mrRef.current.pause();
    }).then((f) => offs.push(f)).catch(() => {});
    listen("rec-cam-record-resume", () => {
      if (mrRef.current?.state === "paused") mrRef.current.resume();
    }).then((f) => offs.push(f)).catch(() => {});
    listen("rec-cam-record-stop", () => {
      const mr = mrRef.current;
      if (mr && mr.state !== "inactive") mr.stop(); // fires onstop → rec-cam-record-saved
      else emit("rec-cam-record-saved").catch(() => {}); // nothing to flush; unblock stop
    }).then((f) => offs.push(f)).catch(() => {});

    return () => {
      cancelled = true;
      offs.forEach((f) => f());
      if (mrRef.current && mrRef.current.state !== "inactive") { try { mrRef.current.stop(); } catch { /* ignore */ } }
      mrRef.current = null;
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
    // rounded/rect windows are 16:9; circle/square are 1:1 (keep the aspect on resize).
    const ratio = shape === "rounded" || shape === "rect" ? 9 / 16 : 1;
    const curH = cur * ratio;
    const dimH = dim * ratio;
    const scale = await win.scaleFactor();
    const pos = await win.outerPosition(); // physical
    const dx = Math.round((dim - cur) * scale);
    const dy = Math.round((dimH - curH) * scale);
    await win.setSize(new LogicalSize(dim, dimH));
    await win.setPosition(new PhysicalPosition(pos.x - dx, pos.y - dy));
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
    <div className={`reccam reccam--${shape}`} onPointerDown={onPointerDown}>
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
