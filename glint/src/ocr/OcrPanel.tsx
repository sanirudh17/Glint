/** OcrPanel.tsx — Single small focus window for extracted text: Save as .txt & Copy. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ScanText, SearchX } from "lucide-react";
import { ocrResult, ocrCopy, type OcrResult } from "../lib/ocr";
import { hasText as hasTextOf, countsLabel, copyTarget } from "./ocrPanelModel";
import "./ocr.css";

export function OcrPanel() {
  const [res, setRes] = useState<OcrResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ocrResult().then((r) => { setRes(r); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") getCurrentWindow().close().catch(() => {}); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copy = async () => {
    const el = ref.current; if (!el) return;
    await ocrCopy(copyTarget(el.value, el.selectionStart, el.selectionEnd)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveTxt = () => {
    const text = ref.current?.value ?? res?.text ?? "";
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `glint-text-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const hasText = hasTextOf(res);

  return (
    <div className="ocr-root">
      <header className="ocr-header">
        <div className="ocr-meta">
          <ScanText size={15} strokeWidth={1.5} className="ocr-icon" aria-hidden="true" />
          <span className="ocr-label">Captured Text</span>
          {hasText && <span className="ocr-counts">{countsLabel(res!)}</span>}
        </div>
        {copied && (
          <div className="ocr-copied-badge" role="status">
            <Check size={13} strokeWidth={2} aria-hidden="true" />
            <span>Copied</span>
          </div>
        )}
      </header>

      {loaded && !hasText ? (
        <div className="ocr-empty">
          <SearchX size={20} strokeWidth={1.5} aria-hidden="true" />
          <span>No text detected in this capture.</span>
        </div>
      ) : (
        <div className="ocr-body">
          <textarea
            ref={ref}
            className="ocr-text"
            defaultValue={res?.text ?? ""}
            readOnly
            spellCheck={false}
            aria-label="Extracted text"
          />
        </div>
      )}

      <footer className="ocr-footer">
        <div className="ocr-actions">
          <button
            type="button"
            className="ocr-btn"
            disabled={!hasText}
            onClick={saveTxt}
          >
            Save as .txt
          </button>
          <button
            type="button"
            className="ocr-btn ocr-btn--primary"
            disabled={!hasText}
            onClick={copy}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </footer>
    </div>
  );
}
