/** OcrPanel.tsx — OCR sheet dialog (#/ocr window): read-only text, copy, save. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ScanText, SearchX, X } from "lucide-react";
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

  // Renderer-side .txt export (Blob download — no backend involved). The text
  // is already in memory, so this adds no pipeline, schema, or IPC changes.
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
      <div className="ocr-sheet" role="dialog" aria-label="Extracted text">
        <div className="ocr-header">
          {/* No source thumbnail exists in OcrResult — an icon tile stands in. */}
          <span className="ocr-icon" aria-hidden="true">
            <ScanText size={17} strokeWidth={1.5} />
          </span>
          <div className="ocr-titleblock">
            <span className="ocr-title">Extracted Text</span>
            {hasText && <span className="ocr-counts">{countsLabel(res!)}</span>}
          </div>
          <span className="ocr-spacer" />
          <button
            type="button"
            className="ocr-close"
            aria-label="Close"
            onClick={() => getCurrentWindow().close()}
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        {loaded && !hasText ? (
          <div className="ocr-empty">
            <SearchX size={22} strokeWidth={1.5} className="ocr-empty-icon" aria-hidden="true" />
            <span>No text found in that region.</span>
            <span className="ocr-empty-hint">Try a larger region with clearer contrast.</span>
          </div>
        ) : (
          hasText && (
            <div className="ocr-well">
              <textarea
                ref={ref}
                className="ocr-text"
                defaultValue={res!.text}
                readOnly
                onChange={() => setCopied(false)}
                spellCheck={false}
                aria-label="Extracted text"
              />
            </div>
          )
        )}

        {copied && (
          <div className="ocr-status" role="status">
            <Check size={14} strokeWidth={1.5} className="ocr-ok" aria-hidden="true" />
            <span>Copied to clipboard</span>
          </div>
        )}

        <div className="ocr-actions">
          {hasText && (
            <button type="button" className="ocr-btn" onClick={saveTxt}>
              Save as .txt
            </button>
          )}
          {hasText && (
            <button type="button" className="ocr-btn ocr-btn--primary" onClick={copy}>
              Copy All
            </button>
          )}
          <button type="button" className="ocr-btn" onClick={() => getCurrentWindow().close()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
