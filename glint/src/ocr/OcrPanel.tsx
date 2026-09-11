/** OcrPanel.tsx — Single small focus window for extracted text: Save as .txt & Copy. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Check, ScanText, SearchX, X } from "lucide-react";
import { ocrResult, ocrCopy, type OcrResult } from "../lib/ocr";
import { hasText as hasTextOf, countsLabel, copyTarget } from "./ocrPanelModel";
import "./ocr.css";

export function OcrPanel() {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const reload = () => {
    ocrResult()
      .then((r) => {
        setText(r?.text ?? "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    const un = listen("ocr-reload", () => {
      reload();
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  const closeWindow = () => {
    try {
      getCurrentWindow().hide().catch(() => getCurrentWindow().close().catch(() => {}));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copy = async () => {
    const el = ref.current;
    const targetText = el ? copyTarget(el.value, el.selectionStart, el.selectionEnd) : text;
    await ocrCopy(targetText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveTxt = () => {
    const content = text || ref.current?.value || "";
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `glint-text-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const currentRes: OcrResult = {
    text,
    line_count: text ? text.split("\n").length : 0,
    word_count: text ? text.split(/\s+/).filter(Boolean).length : 0,
  };
  const hasText = hasTextOf(currentRes);

  return (
    <div className="ocr-root">
      <header className="ocr-header" data-tauri-drag-region>
        <div className="ocr-meta">
          <ScanText size={15} strokeWidth={1.5} className="ocr-icon" aria-hidden="true" />
          <span className="ocr-label">Captured Text</span>
          {hasText && <span className="ocr-counts">{countsLabel(currentRes)}</span>}
        </div>
        <div className="ocr-header-right">
          {copied && (
            <div className="ocr-copied-badge" role="status">
              <Check size={13} strokeWidth={2} aria-hidden="true" />
              <span>Copied</span>
            </div>
          )}
          <button
            type="button"
            className="ocr-close-btn"
            onClick={closeWindow}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
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
            value={text}
            onChange={(e) => setText(e.target.value)}
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
