/** RecCam.tsx — webcam bubble (route #/rec-cam). Task 1: minimal camera render. */
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import "./reccam.css";

export function RecCam() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch(() => {
        // No camera / permission denied — tell the main window, then close.
        emit("glint-toast", "Camera unavailable").catch(() => {});
        getCurrentWindow().close().catch(() => {});
      });
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="reccam">
      <video ref={videoRef} className="reccam-video" autoPlay muted playsInline />
    </div>
  );
}
