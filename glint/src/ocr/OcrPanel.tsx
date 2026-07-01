/** OcrPanel.tsx — OCR review panel (#/ocr). Minimal first: read + show text. */
import { useEffect, useState } from "react";
import { ocrResult, type OcrResult } from "../lib/ocr";
import "./ocr.css";

export function OcrPanel() {
  const [res, setRes] = useState<OcrResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    ocrResult().then((r) => { setRes(r); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  return (
    <div className="ocr-root">
      {loaded && (!res || !res.text) && <div className="ocr-empty">No text found.</div>}
      {res && res.text && <textarea className="ocr-text" defaultValue={res.text} readOnly />}
    </div>
  );
}
