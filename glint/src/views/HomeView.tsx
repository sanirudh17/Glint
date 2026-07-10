import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Crop, AppWindow, Monitor, Video, ImageOff, FolderOpen, ScanText, RotateCcw, ArrowRight } from "lucide-react";
import { Button, EmptyState } from "../components/ui";
import { useAppStore } from "../store/useAppStore";
import { startCapture } from "../lib/captureIpc";
import { captureText } from "../lib/ocr";
import { listCaptures, type CaptureItem } from "../lib/captures";
import { getRecentProjects, openProject, pickOpenPath, pushRecentProject, type RecentProject } from "../lib/editor";
import { CaptureCard } from "./library/CaptureCard";
import "./home.css";

/** Recent captures previewed on the dashboard (newest first). */
const RECENT_LIMIT = 10;
/** Recent .glint projects offered in the conditional Resume row. */
const RESUME_LIMIT = 3;

export default function HomeView() {
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigate();

  // Recent captures — newest first, capped.
  const [recent, setRecent] = useState<CaptureItem[]>([]);
  const reloadRecent = useCallback(() => {
    listCaptures(RECENT_LIMIT).then(setRecent).catch(() => setRecent([]));
  }, []);
  useEffect(() => { reloadRecent(); }, [reloadRecent]);
  useEffect(() => {
    const p = listen("capture-saved", () => reloadRecent());
    return () => { p.then((un) => un()); };
  }, [reloadRecent]);

  // Recent projects — drives the conditional Resume row.
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const reloadProjects = useCallback(() => {
    getRecentProjects().then(setProjects).catch(() => setProjects([]));
  }, []);
  useEffect(() => { reloadProjects(); }, [reloadProjects]);

  const onOpenProject = useCallback(async () => {
    const path = await pickOpenPath();
    if (!path) return;
    try { await openProject(path); await pushRecentProject(path); }
    catch { pushToast("Couldn't open the project"); }
  }, [pushToast]);

  const onOpenRecent = useCallback(async (p: RecentProject) => {
    if (!p.exists) { pushToast("That project file is no longer on disk"); reloadProjects(); return; }
    try { await openProject(p.path); await pushRecentProject(p.path); }
    catch { pushToast("Couldn't open the project"); }
  }, [pushToast, reloadProjects]);

  // Not-yet-built tray actions still emit "tray-action" (e.g. some record paths).
  useEffect(() => {
    const unlisten = listen<string>("tray-action", (event) => {
      const msg: Record<string, string> = { record: "Recording arrives in a later phase" };
      pushToast(msg[event.payload] ?? "That action arrives in a later phase");
    });
    return () => { unlisten.then((f) => f()); };
  }, [pushToast]);

  const resumable = projects.slice(0, RESUME_LIMIT);

  return (
    <div className="home-view">
      {/* ── New capture ─────────────────────────────────────── */}
      <section className="home-section" aria-labelledby="nc-label">
        <span className="label home-eyebrow" id="nc-label">New capture</span>
        <div className="home-actions">
          <Button variant="primary" size="md" icon={Crop} onClick={() => startCapture("area")}>Capture Area</Button>
          <Button variant="subtle" size="md" icon={AppWindow} onClick={() => startCapture("window")}>Window</Button>
          <Button variant="subtle" size="md" icon={Monitor} onClick={() => startCapture("fullscreen")}>Fullscreen</Button>
          <Button variant="subtle" size="md" icon={Video} onClick={() => invoke("recorder_open_region_selector")}>Record</Button>
          <Button variant="subtle" size="md" icon={ScanText} onClick={() => captureText()}>Capture Text</Button>
          <Button variant="ghost" size="md" icon={FolderOpen} onClick={onOpenProject}>Open Project</Button>
        </div>
      </section>

      {/* ── Recent ──────────────────────────────────────────── */}
      <section className="home-section home-section--grow" aria-labelledby="rc-label">
        <div className="home-rowhead">
          <span className="label home-eyebrow" id="rc-label">Recent</span>
          {recent.length > 0 && (
            <button className="home-viewall" onClick={() => navigate("/library")}>
              View all in Library <ArrowRight size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="home-empty-wrap">
            <EmptyState icon={ImageOff} title="No captures yet" hint="Your screenshots and recordings will appear here." />
          </div>
        ) : (
          <div className="home-recent-grid" role="list" aria-label="Recent captures">
            {recent.map((c) => (<CaptureCard key={c.id} item={c} onChanged={reloadRecent} />))}
          </div>
        )}
      </section>

      {/* ── Resume (conditional) ────────────────────────────── */}
      {resumable.length > 0 && (
        <section className="home-section" aria-labelledby="rs-label">
          <span className="label home-eyebrow" id="rs-label">Resume</span>
          <div className="home-resume" role="list">
            {resumable.map((p) => (
              <button
                key={p.path}
                className={`home-resume-chip${p.exists ? "" : " home-resume-chip--stale"}`}
                onClick={() => onOpenRecent(p)}
                title={p.exists ? p.path : `${p.path} (missing)`}
              >
                <RotateCcw size={14} strokeWidth={1.75} />
                <span className="home-resume-name">{p.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
