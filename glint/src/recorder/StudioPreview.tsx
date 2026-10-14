import { drawCursorLayer, smoothPath } from "./studioCursor";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getGradient, konvaGradient } from "../editor/gradients";
import { resolveRadiusPx } from "../editor/composition";
import { studioLayout } from "./studioLayout";
import type { StudioData } from "./studioModel";
import type { CamPlacement } from "./camOverlay";
import { toPixels } from "./camOverlay";

export function StudioPreview({ studio, video, camVideo, cam, width, height }: {
  studio: StudioData; video: RefObject<HTMLVideoElement | null>; camVideo: RefObject<HTMLVideoElement | null>;
  cam: CamPlacement | null; width: number; height: number;
}) {
  const path = useMemo(() => smoothPath(studio.events.events, studio.project.cursor.smoothing), [studio.events, studio.project.cursor.smoothing]);
  const effectEvents = useMemo(() => ({ ...studio.events, events: studio.events.events.filter((e) => e.kind !== "cursor") }), [studio.events]);
  const ref = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const background = studio.project.look.background;
  useEffect(() => {
    setImage(null); if (background.type !== "image" || !background.dataUrl) return;
    let active = true; const img = new Image(); img.onload = () => { if (active) setImage(img); }; img.src = background.dataUrl;
    return () => { active = false; };
  }, [background]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const canvas = ref.current, v = video.current;
      if (canvas && v && v.readyState >= 2) {
        const { look, crop } = studio.project;
        const { layout: l, scale, width: w, height: h } = studioLayout(width, height, crop, look, 960);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext("2d")!;
        ctx.resetTransform(); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); ctx.scale(scale, scale);
        if (look.enabled && background.type === "solid") { ctx.fillStyle = background.color; ctx.fillRect(0, 0, l.compositionW, l.compositionH); }
        if (look.enabled && background.type === "gradient") {
          const g = getGradient(background.gradientId), props = konvaGradient(g, l.compositionW, l.compositionH);
          const start = props.fillLinearGradientStartPoint, end = props.fillLinearGradientEndPoint;
          const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y); g.stops.forEach((s) => gradient.addColorStop(s.offset, s.color)); ctx.fillStyle = gradient; ctx.fillRect(0, 0, l.compositionW, l.compositionH);
        }
        if (look.enabled && background.type === "image" && image) {
          const cover = Math.max(l.compositionW / image.width, l.compositionH / image.height);
          ctx.drawImage(image, 0, 0, image.width * cover, image.height * cover);
        }
        const radius = look.enabled ? resolveRadiusPx(look.radius, l.contentW, l.contentH) : 0;
        const top = l.contentY - l.chromeH, cardH = l.contentH + l.chromeH;
        ctx.save();
        if (look.enabled && look.shadow > 0) {
          const edge = Math.max(l.contentW, l.contentH), t = look.shadow / 100;
          ctx.shadowColor = look.shadowColor ?? "#000"; ctx.shadowBlur = (0.02 + t * .1) * edge * scale; ctx.shadowOffsetY = (.01 + t * .05) * edge * scale;
          ctx.globalAlpha = .2 + t * .5;
        }
        ctx.beginPath(); ctx.roundRect(l.contentX, top, l.contentW, cardH, radius); ctx.fillStyle = "#000"; ctx.fill(); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.roundRect(l.contentX, top, l.contentW, cardH, radius); ctx.clip();
        ctx.drawImage(v, l.cropX, l.cropY, l.contentW, l.contentH, l.contentX, l.contentY, l.contentW, l.contentH);
        if (cam?.visible && camVideo.current && camVideo.current.readyState >= 2) {
          const box = toPixels(cam, width, height, width / height);
          ctx.save(); ctx.translate(l.contentX - l.cropX + box.x, l.contentY - l.cropY + box.y);
          ctx.beginPath(); ctx.roundRect(0, 0, box.w, box.h, cam.shape === "circle" ? box.w / 2 : cam.shape === "rect" ? 0 : box.w * .14); ctx.clip();
          const cv = camVideo.current, ratio = box.w / box.h, native = cv.videoWidth / cv.videoHeight;
          const sw = native > ratio ? cv.videoHeight * ratio : cv.videoWidth, sh = native > ratio ? cv.videoHeight : cv.videoWidth / ratio;
          ctx.drawImage(cv, (cv.videoWidth - sw) / 2, (cv.videoHeight - sh) / 2, sw, sh, 0, 0, box.w, box.h); ctx.restore();
        }
        drawCursorLayer(ctx, v.currentTime, path, effectEvents, studio.project.cursor, l, width, height);
        if (l.chromeH > 0) {
          ctx.fillStyle = look.chrome.theme === "dark" ? "#25272c" : "#eeeeee"; ctx.fillRect(l.contentX, top, l.contentW, l.chromeH);
          ctx.fillStyle = look.chrome.theme === "dark" ? "#ffffff" : "#202020"; ctx.font = `${l.chromeH * .35}px sans-serif`; ctx.textAlign = "center";
          ctx.fillText(look.chrome.style === "browser" ? look.chrome.url : look.chrome.title, l.contentX + l.contentW / 2, top + l.chromeH * .64);
        }
        ctx.restore();
        if (look.enabled && (look.border?.width ?? 0) > 0) {
          ctx.beginPath(); ctx.roundRect(l.contentX, top, l.contentW, cardH, radius); ctx.strokeStyle = look.border!.color; ctx.lineWidth = look.border!.width; ctx.setLineDash(look.border!.style === "dashed" ? [8, 6] : []); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [studio, video, camVideo, cam, width, height, background, image, path, effectEvents]);
  return <canvas ref={ref} className="studio-preview" aria-label="Studio video preview" />;
}
