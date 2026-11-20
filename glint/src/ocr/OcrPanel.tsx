/** OcrPanel.tsx — small focus window for extracted text: edit, Save…, Copy. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { nextPaint } from "../overlay/nextPaint";
import { Check, ScanText, SearchX, X } from "../icons";
import { ocrResult, ocrCopy, type OcrResult } from "../lib/ocr";
import { hasText as hasTextOf, copyTarget } from "./ocrPanelModel";
import "./ocr.css";

export function OcrPanel() {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Load the latest result; once that frame has painted, ask native to reveal the
  // window (it ignores this unless an open was requested, e.g. a background prewarm).
  const reload = () => {
    ocrResult()
      .then((r) => {
        setText(r?.text ?? "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true))
      .then(() => nextPaint())
      .then(() => invoke("ocr_present"))
      .catch(() => {});
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

  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Native Save dialog + write (a browser-style download does nothing in a WebView).
  const saveTxt = async () => {
    const content = ref.current?.value ?? text;
    if (!content) return;
    setSaveError("");
    try {
      if (await invoke<boolean>("ocr_save_text", { text: content })) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      setSaveError(String(e));
    }
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
        <span className="ocr-title" data-tauri-drag-region>
          <ScanText size={14} strokeWidth={1.5} aria-hidden="true" />
          Text
        </span>
        <button
          type="button"
          className="ocr-close-btn"
          onClick={closeWindow}
          aria-label="Close"
          title="Close (Esc)"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>

      {loaded && !hasText ? (
        <div className="ocr-empty" role="status">
          <SearchX size={18} strokeWidth={1.5} aria-hidden="true" />
          <span>No text found</span>
        </div>
      ) : (
        <textarea
          ref={ref}
          className="ocr-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Extracted text"
        />
      )}

      <footer className="ocr-footer">
        {saveError && <span className="ocr-error" role="alert">{saveError}</span>}
        <button type="button" className="ocr-btn" disabled={!hasText} onClick={() => void saveTxt()} aria-live="polite">
          {saved && <Check size={14} strokeWidth={2} aria-hidden="true" />}
          {saved ? "Saved" : "Save…"}
        </button>
        <button type="button" className="ocr-btn ocr-btn--primary" disabled={!hasText} onClick={copy} aria-live="polite">
          {copied && <Check size={14} strokeWidth={2} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </footer>
    </div>
  );
}
