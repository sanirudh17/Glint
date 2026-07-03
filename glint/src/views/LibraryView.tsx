import { useCallback, useEffect, useState } from "react";
import { Images } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { EmptyState, Select } from "../components/ui";
import { listCaptures, type CaptureItem } from "../lib/captures";
import { CaptureCard } from "./library/CaptureCard";
import { matchesCapture } from "./library/search";
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

  const reload = useCallback(() => {
    listCaptures().then(setCaptures).catch(() => setCaptures([]));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Refresh when a new capture is saved (or one is deleted elsewhere).
  useEffect(() => {
    const p = listen("capture-saved", () => reload());
    return () => { p.then((un) => un()); };
  }, [reload]);

  const visible = captures.filter((c) => {
    const matchesKind = kind === "all" || c.kind === kind;
    return matchesKind && matchesCapture(c, search);
  });

  const isEmpty = visible.length === 0;

  return (
    <div className="library-view">
      <section className="library-section" aria-label="Library controls">
        <span className="label library-section-label" id="lib-label">Library</span>
        <div className="library-bar" role="search" aria-label="Filter captures">
          <input
            className="library-search"
            type="search"
            placeholder="Search by name or date…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search captures by name or date"
          />
          <Select value={kind} options={KIND_OPTIONS} onChange={setKind} />
        </div>
      </section>

      <section className="library-section library-section--grow" aria-labelledby="lib-label">
        {isEmpty ? (
          <div className="library-empty-wrap">
            <EmptyState
              icon={Images}
              title="Your library is empty"
              hint="Screenshots you take will be collected here."
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
