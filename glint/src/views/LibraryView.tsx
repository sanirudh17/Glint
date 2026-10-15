import { useCallback, useEffect, useState } from "react";
import { Images, Search } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EmptyState, Select } from "../components/ui";
import { listCaptures, type CaptureItem } from "../lib/captures";
import { CaptureCard } from "./library/CaptureCard";
import { matchesCapture } from "./library/search";
import {invoke} from '@tauri-apps/api/core';
import {useAppStore} from '../store/useAppStore';
import "./library.css";

const KIND_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "screenshot", label: "Screenshots" },
  { value: "recording",  label: "Recordings" },
];

export default function LibraryView() {
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [search, setSearch]     = useState("");
  const [kind, setKind]         = useState("all");
  const [textMatches,setTextMatches]=useState<Set<number>>(new Set());
  const [progress,setProgress]=useState({running:false,done:0,total:0,errors:0}),[indexError,setIndexError]=useState('');
  const textEnabled=useAppStore(s=>s.settings?.index_screenshot_text??true);
  const [indexRun,setIndexRun]=useState(0);

  const reload = useCallback(() => {
    listCaptures().then(setCaptures).catch(() => setCaptures([]));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Refresh when a new capture is saved (or one is deleted elsewhere).
  useEffect(() => {
    const p = listen("capture-saved", () => {reload();setIndexRun(v=>v+1);});
    return () => { p.then((un) => un()); };
  }, [reload]);
  useEffect(()=>{
    if(!textEnabled)return;let alive=true,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const value=await invoke<typeof progress>('library_index_status');if(!alive)return;setProgress(value);if(value.running)timer=setTimeout(()=>void poll(),700);else reload();}catch{if(alive)setIndexError('Screenshot text could not be read. Try again.');}};
    void invoke('library_index_start').then(()=>poll()).catch(()=>{if(alive)setIndexError('Screenshot text could not be read. Try again.');});
    const un=listen('library-indexed',()=>{void poll();});
    return()=>{alive=false;clearTimeout(timer);void un.then(f=>f());};
  },[textEnabled,indexRun,reload]);
  useEffect(()=>{
    let alive=true;setTextMatches(new Set());if(!search.trim()||!textEnabled)return;
    const timer=setTimeout(()=>{void invoke<number[]>('library_search_text',{query:search}).then(ids=>{if(alive)setTextMatches(new Set(ids));}).catch(()=>{if(alive)setIndexError('Text search is unavailable. Name and date search still work.');});},120);
    return()=>{alive=false;clearTimeout(timer);};
  },[search,textEnabled,progress.done,progress.running]);

  // Reconcile on window focus: listCaptures prunes captures whose file was deleted
  // in Explorer/the system, so tabbing back to Glint clears any that vanished while
  // it was in the background — no stale rows that error when clicked.
  useEffect(() => {
    const p = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) reload();
    });
    return () => { p.then((un) => un()); };
  }, [reload]);

  const visible = captures.filter((c) => {
    const matchesKind = kind === "all" || c.kind === kind;
    return matchesKind && (matchesCapture(c, search)||textMatches.has(c.id));
  });

  const isEmpty = visible.length === 0;

  return (
    <div className="library-view">
      <section className="library-section" aria-label="Library controls">
        <div className="library-head">
          <span className="label library-section-label" id="lib-label">Library</span>
          {captures.length > 0 && (
            <span className="library-count">
              {visible.length === captures.length
                ? `${captures.length} ${captures.length === 1 ? "capture" : "captures"}`
                : `${visible.length} of ${captures.length}`}
            </span>
          )}
        </div>
        <div className="library-bar" role="search" aria-label="Filter captures">
          <div className="library-search-wrap">
            <Search className="library-search-icon" size={15} strokeWidth={1.5} aria-hidden="true" />
            <input
              className="library-search"
              type="search"
              placeholder="Search names, dates or screenshot text…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              aria-label="Search captures by name, date or screenshot text"
            />
          </div>
          <Select value={kind} options={KIND_OPTIONS} onChange={setKind} />
        </div>
        {textEnabled&&captures.some(c=>c.kind==='screenshot')&&<div className="library-index-status">
          <span role="status" aria-live="polite">{indexError|| (progress.running?`Reading screenshot text · ${progress.done} of ${progress.total}`:progress.errors?`${progress.errors} images could not be read.`:progress.total&&progress.done<progress.total?'Text scan paused.': 'Screenshot text stays on this device.')}</span>
          {progress.running?<button className="g-btn g-btn-subtle g-btn-sm" onClick={()=>void invoke('library_index_cancel')}>Cancel text scan</button>
            :<button className="g-btn g-btn-subtle g-btn-sm" onClick={async()=>{setIndexError('');try{if(progress.errors)await invoke('library_index_clear');setIndexRun(v=>v+1);}catch{setIndexError('Screenshot text could not be read. Try again.');}}}>{progress.errors?'Retry text scan':'Read screenshot text'}</button>}
        </div>}
      </section>

      <section className="library-section library-section--grow" aria-labelledby="lib-label">
        {isEmpty ? (
          <div className="library-empty-wrap">
            <EmptyState
              icon={Images}
              title={captures.length?'No matching captures':'Your library is empty'}
              hint={captures.length?'Try a different word or capture type.':'Screenshots you take will be collected here.'}
            />
          </div>
        ) : (
          <div className="library-grid" role="list" aria-label="Captures">
            {visible.map((c) => (
              <CaptureCard key={c.id} item={c} onChanged={reload} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
