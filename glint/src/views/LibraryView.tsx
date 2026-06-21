import { useEffect, useState } from "react";
import { Images } from "lucide-react";
import { EmptyState, Select } from "../components/ui";
import { loadCaptures, type CaptureRow } from "../lib/ipc";
import "./library.css";

// Kind-filter options shown in the Select
const KIND_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "screenshot", label: "Screenshots" },
  { value: "recording",  label: "Recordings" },
];

export default function LibraryView() {
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [search, setSearch]     = useState("");
  const [kind, setKind]         = useState("all");

  // Load from SQLite on mount. In the non-Tauri / plain-Vite preview the
  // plugin is absent — the .catch() absorbs the error and leaves the list
  // empty, so the shell renders an honest empty state rather than crashing.
  useEffect(() => {
    loadCaptures()
      .then(setCaptures)
      .catch(() => setCaptures([]));
  }, []);

  // Filter in-memory (both predicates are no-ops when the list is empty, but
  // the logic is correct and ready for real rows in Phase 2).
  const visible = captures.filter((c) => {
    const matchesKind   = kind === "all" || c.kind === kind;
    const matchesSearch =
      search.trim() === "" ||
      c.path.toLowerCase().includes(search.toLowerCase()) ||
      (c.app_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.window_title ?? "").toLowerCase().includes(search.toLowerCase());
    return matchesKind && matchesSearch;
  });

  const isEmpty = visible.length === 0;

  return (
    <div className="library-view">
      {/* ── Header zone ──────────────────────────────────────────── */}
      <section className="library-section" aria-label="Library controls">
        <span className="label library-section-label" id="lib-label">
          Library
        </span>

        {/* Filter bar — sits flush under the eyebrow hairline */}
        <div className="library-bar" role="search" aria-label="Filter captures">
          <input
            className="library-search"
            type="search"
            placeholder="Search captures…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search captures by name or app"
          />
          <Select
            value={kind}
            options={KIND_OPTIONS}
            onChange={setKind}
          />
        </div>
      </section>

      {/* ── Capture grid / empty state ────────────────────────────── */}
      <section
        className="library-section library-section--grow"
        aria-labelledby="lib-label"
      >
        {isEmpty ? (
          <div className="library-empty-wrap">
            <EmptyState
              icon={Images}
              title="Your library is empty"
              hint="Captures you take will be collected here."
            />
          </div>
        ) : (
          <div className="library-grid" role="list" aria-label="Captures">
            {visible.map((c) => (
              // Phase 2 will render a real CaptureCard here.
              // For now, each row is a plain placeholder that proves the
              // data path without faking visual richness.
              <div key={c.id} className="library-card-stub" role="listitem">
                <span className="library-card-path">{c.path}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
