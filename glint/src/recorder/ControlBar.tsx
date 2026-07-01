/** ControlBar.tsx — the floating REC indicator (route #/rec-bar). */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { recorderStop, recorderPause, recorderResume, recorderStatus, recorderSetMute, recorderSetWebcam, recorderSetFx } from "../lib/recorder";
import { Square, Pause, Play, Mic, MicOff, Volume2, VolumeX, Video, VideoOff, MousePointerClick, Keyboard, Sun } from "lucide-react";
import "./recorder.css";

export function mmss(total: number): string {
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ControlBar() {
  const [secs, setSecs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which audio sources are available + their live mute state. null until status
  // loads. Both system and mic show whenever the recording has any audio, so either
  // can be muted/unmuted live (a source off at start simply begins muted).
  const [audio, setAudio] = useState<{ system: boolean; mic: boolean; sysMuted: boolean; micMuted: boolean } | null>(null);
  // Webcam toggle — always shown so it can be enabled live even if off at start.
  const [camOn, setCamOn] = useState(false);
  // Live-togglable FX (click/keystroke/spotlight). null until status loads.
  const [fx, setFx] = useState<{ clickViz: boolean; keystrokes: boolean; spotlight: boolean } | null>(null);

  useEffect(() => {
    const load = () =>
      recorderStatus().then((s) => {
        if (s) {
          setAudio({ system: s.system, mic: s.mic, sysMuted: s.system_muted, micMuted: s.mic_muted });
          setCamOn(s.webcam);
          setFx({ clickViz: s.click_viz, keystrokes: s.keystrokes, spotlight: s.spotlight });
        }
      }).catch(() => {});
    // The bar appears the instant the countdown ends (before ffmpeg is fully up),
    // so the first read uses optimistic availability; refresh when the recording
    // is actually running to drop a toggle for a source whose device was missing.
    // A delayed re-read is a fallback in case the bar's webview cold-loads after
    // `recorder-started` already fired (event missed).
    load();
    const un = listen("recorder-started", load);
    // The bubble's ✕ turns the webcam off through the backend, which emits this so
    // the toggle here reflects the change (otherwise it would still read "on").
    const unCam = listen<boolean>("recorder-webcam", (e) => setCamOn(e.payload));
    // FX toggled elsewhere (e.g. by another path) → reflect it here.
    const unFx = listen<{ effect: string; on: boolean }>("recorder-fx", (e) => {
      setFx((f) => f && {
        clickViz: e.payload.effect === "click_viz" ? e.payload.on : f.clickViz,
        keystrokes: e.payload.effect === "keystrokes" ? e.payload.on : f.keystrokes,
        spotlight: e.payload.effect === "spotlight" ? e.payload.on : f.spotlight,
      });
    });
    const t = window.setTimeout(load, 2000);
    return () => {
      window.clearTimeout(t);
      un.then((f) => f()).catch(() => {});
      unCam.then((f) => f()).catch(() => {});
      unFx.then((f) => f()).catch(() => {});
    };
  }, []);

  // Flip local state only on a successful set — backend errors leave it as-is.
  async function toggleMute(src: "system" | "mic", next: boolean) {
    try { await recorderSetMute(src, next); } catch { return; }
    setAudio((a) => a && { ...a, ...(src === "system" ? { sysMuted: next } : { micMuted: next }) });
  }

  async function toggleWebcam(next: boolean) {
    try { await recorderSetWebcam(next); } catch { return; }
    setCamOn(next);
  }

  // Flip local FX state only on a successful set.
  async function toggleFx(effect: "click_viz" | "keystrokes" | "spotlight", next: boolean) {
    try { await recorderSetFx(effect, next); } catch { return; }
    setFx((f) => f && {
      clickViz: effect === "click_viz" ? next : f.clickViz,
      keystrokes: effect === "keystrokes" ? next : f.keystrokes,
      spotlight: effect === "spotlight" ? next : f.spotlight,
    });
  }

  // The timer counts only while running — paused time is excised from the video,
  // so the elapsed shown here matches the final recording's duration.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [paused]);

  // Flip state only on a successful pause/resume — backend toasts on failure.
  async function togglePause() {
    if (busy) return;
    setBusy(true);
    try {
      if (paused) { await recorderResume(); setPaused(false); }
      else { await recorderPause(); setPaused(true); }
    } catch { /* a failure toast already reached the user */ }
    finally { setBusy(false); }
  }

  return (
    <div className="rec-bar">
      <span className={`rec-dot${paused ? " rec-dot--paused" : ""}`} aria-hidden />
      <span className="rec-time">{mmss(secs)}</span>
      {audio?.system && (
        <button
          className={`rec-atog${audio.sysMuted ? " rec-atog--off" : ""}`}
          onClick={() => toggleMute("system", !audio.sysMuted)}
          title={audio.sysMuted ? "Unmute system audio" : "Mute system audio"}
          aria-label="Toggle system audio"
        >
          {audio.sysMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      )}
      {audio?.mic && (
        <button
          className={`rec-atog${audio.micMuted ? " rec-atog--off" : ""}`}
          onClick={() => toggleMute("mic", !audio.micMuted)}
          title={audio.micMuted ? "Unmute microphone" : "Mute microphone"}
          aria-label="Toggle microphone"
        >
          {audio.micMuted ? <MicOff size={13} /> : <Mic size={13} />}
        </button>
      )}
      <button
        className={`rec-atog${camOn ? "" : " rec-atog--off"}`}
        onClick={() => toggleWebcam(!camOn)}
        title={camOn ? "Turn off webcam" : "Turn on webcam"}
        aria-label="Toggle webcam"
      >
        {camOn ? <Video size={13} /> : <VideoOff size={13} />}
      </button>
      {fx && (
        <>
          <button
            className={`rec-atog${fx.clickViz ? "" : " rec-atog--off"}`}
            onClick={() => toggleFx("click_viz", !fx.clickViz)}
            title={fx.clickViz ? "Hide click effects" : "Show click effects"}
            aria-label="Toggle click visualization"
          >
            <MousePointerClick size={13} />
          </button>
          <button
            className={`rec-atog${fx.keystrokes ? "" : " rec-atog--off"}`}
            onClick={() => toggleFx("keystrokes", !fx.keystrokes)}
            title={fx.keystrokes ? "Hide keystrokes" : "Show keystrokes"}
            aria-label="Toggle keystroke overlay"
          >
            <Keyboard size={13} />
          </button>
          <button
            className={`rec-atog${fx.spotlight ? "" : " rec-atog--off"}`}
            onClick={() => toggleFx("spotlight", !fx.spotlight)}
            title={fx.spotlight ? "Hide cursor spotlight" : "Show cursor spotlight"}
            aria-label="Toggle cursor spotlight"
          >
            <Sun size={13} />
          </button>
        </>
      )}
      <button
        className="rec-pause"
        onClick={togglePause}
        disabled={busy}
        title={paused ? "Resume recording" : "Pause recording"}
        aria-label={paused ? "Resume recording" : "Pause recording"}
      >
        {paused
          ? <Play size={13} strokeWidth={2.5} fill="currentColor" />
          : <Pause size={13} strokeWidth={2.5} fill="currentColor" />}
      </button>
      <button className="rec-stop" onClick={() => recorderStop()} title="Stop recording" aria-label="Stop">
        <Square size={13} strokeWidth={2.5} fill="currentColor" />
      </button>
    </div>
  );
}
