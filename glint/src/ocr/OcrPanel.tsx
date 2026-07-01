/** OcrPanel.tsx — OCR review panel (#/ocr): editable text, copy, counts, empty state. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ocrResult, ocrCopy, type OcrResult } from "../lib/ocr";
import { hasText as hasTextOf, countsLabel, copyTarget } from "./ocrPanelModel";
import "./ocr.css";

export function OcrPanel() {
  const [res, setRes] = useState<OcrResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false); // nothing is copied until the user clicks Copy
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
  };

  const hasText = hasTextOf(res);

  return (
    <div className="ocr-root">
      <div className="ocr-header">
        {hasText ? (
          <>
            <span className={copied ? "ocr-ok" : "ocr-muted"}>
              {copied ? "Copied to clipboard ✓" : "Select text, or Copy all"}
            </span>
            <span className="ocr-spacer" />
            <span className="ocr-counts">{countsLabel(res!)}</span>
          </>
        ) : (
          <span className="ocr-muted">Captured text</span>
        )}
      </div>

      {loaded && !hasText && <div className="ocr-empty">No text found in that region.</div>}
      {hasText && (
        <textarea
          ref={ref}
          className="ocr-text"
          defaultValue={res!.text}
          onChange={() => setCopied(false)}
          spellCheck={false}
        />
      )}

      <div className="ocr-actions">
        <span className="ocr-spacer" />
        {hasText && <button className="ocr-btn ocr-btn--primary" onClick={copy}>Copy</button>}
        <button className="ocr-btn" onClick={() => getCurrentWindow().close()}>Close</button>
      </div>
    </div>
  );
}
