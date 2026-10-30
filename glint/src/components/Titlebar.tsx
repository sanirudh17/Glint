import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import "./shell.css";

/** Reuses the actual window close path, including the Studio unsaved-change guard. */
export function WindowControls({ onClose }: { onClose?: () => void }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    const sync = () => void win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const unlisten = win.onResized(sync);
    return () => { void unlisten.then(fn => fn()).catch(() => {}); };
  }, []);
  return <div className="g-winctl" aria-label="Window controls">
    <button type="button" className="g-winctl-btn" onClick={() => void getCurrentWindow().minimize()} title="Minimize" aria-label="Minimize"><Minus size={14} strokeWidth={1.5}/></button>
    <button type="button" className="g-winctl-btn" onClick={() => void getCurrentWindow().toggleMaximize()} title={maximized ? "Restore window" : "Maximize"} aria-label={maximized ? "Restore window" : "Maximize"}>{maximized ? <Copy size={12} strokeWidth={1.5}/> : <Square size={12} strokeWidth={1.5}/>}</button>
    <button type="button" className="g-winctl-btn g-winctl-btn--close" onClick={() => onClose ? onClose() : void getCurrentWindow().close()} title="Close" aria-label="Close"><X size={14} strokeWidth={1.5}/></button>
  </div>;
}

/** Overlaid chrome leaves the sidebar and content flush with the window top. */
export function Titlebar() {
  return <div className="g-titlebar"><div className="g-titlebar-drag" data-tauri-drag-region/><WindowControls/></div>;
}
