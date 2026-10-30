import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { Crop, AppWindow, Monitor, Video, ImageOff, FolderOpen, ScanText, RotateCcw, ArrowRight, ChevronDown } from "lucide-react";
import { Button, EmptyState } from "../components/ui";
import { useAppStore } from "../store/useAppStore";
import { startCapture } from "../lib/captureIpc";
import { captureText } from "../lib/ocr";
import { listCaptures, type CaptureItem } from "../lib/captures";
import { getRecentProjects, openProject, pushRecentProject, type RecentProject } from "../lib/editor";
import { popoverPlacement } from "../components/ui/popoverPlacement";
import { CaptureCard } from "./library/CaptureCard";
import "./home.css";

/** Recent captures previewed on the dashboard (newest first). */
const RECENT_LIMIT = 8;
/** Recent .glint projects offered in the conditional Resume row. */
const RESUME_LIMIT = 3;

export default function HomeView() {
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigate();
  const projectMenu = useRef<HTMLDivElement>(null);
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const placeProjects = useCallback(() => {
    const rect = projectTrigger.current?.getBoundingClientRect();
    const menu = projectMenu.current;
    if (!rect || !menu) return;
    const position = popoverPlacement(rect, { width: window.innerWidth, height: window.innerHeight });
    Object.assign(menu.style, {
      width: `${position.width}px`, left: `${position.left}px`,
      top: position.top === undefined ? 'auto' : `${position.top}px`,
      bottom: position.bottom === undefined ? 'auto' : `${position.bottom}px`,
      maxHeight: `${position.maxHeight}px`,
    });
  }, []);
  useEffect(() => {
    if (!projectsOpen) return;
    window.addEventListener('resize', placeProjects);
    document.addEventListener('scroll', placeProjects, true);
    const observer = new ResizeObserver(placeProjects);
    const actionRow = projectTrigger.current?.closest('.home-actions');
    if (actionRow) observer.observe(actionRow);
    return () => {
      window.removeEventListener('resize', placeProjects);
      document.removeEventListener('scroll', placeProjects, true);
      observer.disconnect();
    };
  }, [projectsOpen, placeProjects]);

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

  // Reconcile on window focus — both listCaptures and getRecentProjects prune entries
  // whose file was deleted externally, so returning to Glint clears any capture OR
  // project that vanished on disk in the background instead of leaving a dead row/chip.
  useEffect(() => {
    const p = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) { reloadRecent(); reloadProjects(); }
    });
    return () => { p.then((un) => un()); };
  }, [reloadRecent, reloadProjects]);

  const onOpenProject = useCallback(async () => {
    const path = await open({ filters: [{name:'Glint projects',extensions:['glint','glint-video']}], multiple:false, directory:false });
    if (typeof path !== 'string') return;
    projectMenu.current?.hidePopover();
    try {
      if (path.toLowerCase().endsWith('.glint-video')) {
        let replacingDraft = false;
        try { const draft = JSON.parse(localStorage.getItem('glint-scene-project-draft-v1') ?? 'null'); replacingDraft = !!draft?.dirty && draft.path !== path; } catch { /* No readable draft to replace. */ }
        if (replacingDraft && !await confirm('Open another video project? This will replace the draft kept on this device.', {title:'Open video project',kind:'warning'})) return;
        navigate(`/video-project?path=${encodeURIComponent(path)}`);
      }
      else { await openProject(path); await pushRecentProject(path); }
    }
    catch { pushToast("Couldn't open the project"); }
  }, [pushToast, navigate]);

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
          <Button className="home-capture-action" variant="primary" size="md" icon={Crop} onClick={() => startCapture("area")}>Capture Area</Button>
          <Button variant="subtle" size="md" icon={AppWindow} onClick={() => startCapture("window")}>Window</Button>
          <Button variant="subtle" size="md" icon={Monitor} onClick={() => startCapture("fullscreen")}>Fullscreen</Button>
          <Button variant="subtle" size="md" icon={Video} onClick={() => invoke("recorder_open_region_selector")}>Record</Button>
          <Button variant="subtle" size="md" icon={ScanText} onClick={() => captureText()}>Capture Text</Button>
          <div className="home-project-menu">
            <button type="button" ref={projectTrigger} className="g-btn g-btn-ghost g-btn-md"
              aria-expanded={projectsOpen} aria-controls="home-project-options"
              onClick={() => {
                if (projectsOpen) projectMenu.current?.hidePopover();
                else { placeProjects(); projectMenu.current?.showPopover(); }
              }}>
              <FolderOpen size={16} strokeWidth={1.5}/>Projects<ChevronDown size={14} strokeWidth={1.5}/>
            </button>
            <div id="home-project-options" ref={projectMenu} className="home-project-options" popover="auto"
              role="group" aria-label="Projects" onToggle={(event) => {
                const open = event.newState === 'open';
                setProjectsOpen(open);
                if (!open && document.activeElement === document.body) projectTrigger.current?.focus();
              }}>
              <button type="button" onClick={() => { projectMenu.current?.hidePopover(); navigate('/video-project'); }}><Video size={16} strokeWidth={1.5}/><span>Video project<small>Create a video or resume your draft</small></span></button>
              <button type="button" onClick={() => { projectMenu.current?.hidePopover(); void onOpenProject(); }}><FolderOpen size={16} strokeWidth={1.5}/><span>Open saved project<small>Screenshot or video project</small></span></button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent ──────────────────────────────────────────── */}
      <section className="home-section home-section--grow" aria-labelledby="rc-label">
        <div className="home-rowhead">
          <span className="label home-eyebrow" id="rc-label">Recent</span>
          {recent.length > 0 && (
            <button className="home-viewall" onClick={() => navigate("/library")}>
              View all in Library <ArrowRight size={13} strokeWidth={1.5} />
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="home-empty-wrap">
            <EmptyState icon={ImageOff} title="No captures yet" hint="Your screenshots and recordings will appear here." />
          </div>
        ) : (
          <div className="home-recent-grid" role="list" aria-label="Recent captures">
            {recent.map((c) => (<CaptureCard key={c.id} item={c} onChanged={reloadRecent} variant="home" />))}
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
                <RotateCcw size={14} strokeWidth={1.5} />
                <span className="home-resume-name">{p.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
