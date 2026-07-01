/** FxOverlay (route #/rec-fx) — canvas the recorder draws effects on; gdigrab
 * records it. SPIKE state: draws a static diagonal test pattern so we can confirm
 * the overlay is captured in the MP4. Renderers land in Task 8. */
import { useEffect, useRef } from "react";
import "./recfx.css";

export function FxOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    const ctx = c.getContext("2d")!;
    // SPIKE: a bright translucent border + an X so it's unmistakable on capture.
    ctx.strokeStyle = "rgba(255,64,64,0.9)";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(c.width, c.height);
    ctx.moveTo(c.width, 0); ctx.lineTo(0, c.height);
    ctx.stroke();
  }, []);
  return <canvas ref={ref} className="fx-canvas" />;
}
