import { cursorAt, drawCursorLayer, followSourcePoint, smoothPath } from "./studioCursor";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getGradient, konvaGradient } from "../editor/gradients";
import { resolveRadiusPx } from "../editor/composition";
import { studioLayout } from "./studioLayout";
import type { StudioData } from "./studioModel";
import type { CamPlacement } from "./camOverlay";
import { toPixels } from "./camOverlay";
import { zoomAt } from "./studioEffects";
import { applyPreviewMasks } from "./studioMasks";
import {DEFAULT_MOTION,motionTimes} from './studioMotion';

export function StudioPreview({ studio, video, camVideo, cam, width, height, pickingFocus=false, onFocus }: {
  studio: StudioData; video: RefObject<HTMLVideoElement | null>; camVideo: RefObject<HTMLVideoElement | null>;
  cam: CamPlacement | null; width: number; height: number;
  pickingFocus?:boolean;onFocus?:(point:{x:number;y:number})=>void;
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
    const maskedSource=document.createElement('canvas'),maskScratch=document.createElement('canvas');
    let maskedTime=NaN;
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
        const cursor = followSourcePoint(path,v.currentTime,studio.events,width,height);
        const view = zoomAt(studio.project.zoomSegments, v.currentTime, { x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH },width,height,cursor);
        const previous=zoomAt(studio.project.zoomSegments,Math.max(0,v.currentTime-1/60),{x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH},width,height,followSourcePoint(path,Math.max(0,v.currentTime-1/60),studio.events,width,height));
        const motion=studio.project.motionBlur??DEFAULT_MOTION;
        const times=motionTimes(motion,v.currentTime,Math.abs(view.x-previous.x)+Math.abs(view.y-previous.y)+Math.abs(view.w-previous.w)/2+Math.abs(view.h-previous.h)/2);
        ctx.save(); ctx.translate(l.contentX,l.contentY); ctx.scale(l.contentW/view.w,l.contentH/view.h);
        const hasMasks=studio.project.masks.length>0;
        const sourceCanvas=hasMasks||motion.enabled&&cam?.visible;
        if(sourceCanvas&&maskedTime!==v.currentTime) {
          maskedSource.width=width;maskedSource.height=height;const source=maskedSource.getContext('2d')!;
          source.drawImage(v,0,0,width,height);
          if(cam?.visible&&camVideo.current&&camVideo.current.readyState>=2)paintCamera(source,cam,camVideo.current,width,height);
          applyPreviewMasks(source,studio.project.masks,Math.min(v.currentTime,Math.max(0,v.duration-1e-7)),width,height,maskScratch);
          maskedTime=v.currentTime;
        }
        if(times.length>1) {
          for(const index of [2,1,0]) {
            const time=times[index],pose=zoomAt(studio.project.zoomSegments,time,{x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH},width,height,followSourcePoint(path,time,studio.events,width,height));
            ctx.globalAlpha=index===2?1:index===1?.75:.6;
            ctx.drawImage(sourceCanvas?maskedSource:v,pose.x,pose.y,pose.w,pose.h,0,0,view.w,view.h);
          }ctx.globalAlpha=1;
        } else ctx.drawImage(sourceCanvas?maskedSource:v, view.x, view.y, view.w, view.h, 0, 0, view.w, view.h);
        if (!sourceCanvas && cam?.visible && camVideo.current && camVideo.current.readyState >= 2) {
          const box = toPixels(cam, width, height, width / height);
          ctx.save(); ctx.translate(box.x - view.x, box.y - view.y);
          ctx.beginPath(); ctx.roundRect(0, 0, box.w, box.h, cam.shape === "circle" ? box.w / 2 : cam.shape === "rect" ? 0 : box.w * .14); ctx.clip();
          const cv = camVideo.current, ratio = box.w / box.h, native = cv.videoWidth / cv.videoHeight;
          const sw = native > ratio ? cv.videoHeight * ratio : cv.videoWidth, sh = native > ratio ? cv.videoHeight : cv.videoWidth / ratio;
          ctx.drawImage(cv, (cv.videoWidth - sw) / 2, (cv.videoHeight - sh) / 2, sw, sh, 0, 0, box.w, box.h); ctx.restore();
        }
        const cursorLayout={ ...l,contentX:0,contentY:0,contentW:view.w,contentH:view.h,cropX:view.x,cropY:view.y };
        const a=cursorAt(path,v.currentTime),b=cursorAt(path,Math.max(0,v.currentTime-1/60));
        const movement=a&&b?Math.hypot(a.x-b.x,a.y-b.y)*width/studio.events.geometry.width:0;
        if(motion.enabled&&motion.intensity>0&&movement>8) {
          for(const [offset,alpha] of [[motion.intensity/60,.1],[motion.intensity/120,.25]]) {
            ctx.save();ctx.globalAlpha=alpha;drawCursorLayer(ctx,Math.max(0,v.currentTime-offset),path,effectEvents,{...studio.project.cursor,clicks:false,keystrokes:false},cursorLayout,width,height);ctx.restore();
          }
        }
        drawCursorLayer(ctx, v.currentTime, path, effectEvents, studio.project.cursor, cursorLayout, width, height);
        ctx.restore();
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
  return <><canvas ref={ref} className={`studio-preview${pickingFocus?' is-picking':''}`} aria-label="Studio video preview" onClick={e=>{
    if(!pickingFocus||!onFocus)return;
    const canvas=e.currentTarget,rect=canvas.getBoundingClientRect();
    const fit=Math.min((rect.width-40)/canvas.width,(rect.height-40)/canvas.height);
    const originX=rect.x+20+(rect.width-40-canvas.width*fit)/2,originY=rect.y+20+(rect.height-40-canvas.height*fit)/2;
    const {layout:l,scale}=studioLayout(width,height,studio.project.crop,studio.project.look,960);
    const px=(e.clientX-originX)/fit/scale-l.contentX,py=(e.clientY-originY)/fit/scale-l.contentY;
    if(px<0||py<0||px>l.contentW||py>l.contentH)return;
    const t=video.current?.currentTime??0;
    const view=zoomAt(studio.project.zoomSegments,t,{x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH},width,height,followSourcePoint(path,t,studio.events,width,height));
    onFocus({x:(view.x+px/l.contentW*view.w)/width,y:(view.y+py/l.contentH*view.h)/height});
  }}/>{pickingFocus&&<span className="studio-preview-instruction">Click the video to set zoom focus</span>}</>;
}

function paintCamera(ctx:CanvasRenderingContext2D,cam:CamPlacement,video:HTMLVideoElement,width:number,height:number) {
  const box=toPixels(cam,width,height,width/height);ctx.save();ctx.translate(box.x,box.y);
  ctx.beginPath();ctx.roundRect(0,0,box.w,box.h,cam.shape==='circle'?box.w/2:cam.shape==='rect'?0:box.w*.14);ctx.clip();
  const ratio=box.w/box.h,native=video.videoWidth/video.videoHeight;
  const sw=native>ratio?video.videoHeight*ratio:video.videoWidth,sh=native>ratio?video.videoHeight:video.videoWidth/ratio;
  ctx.drawImage(video,(video.videoWidth-sw)/2,(video.videoHeight-sh)/2,sw,sh,0,0,box.w,box.h);ctx.restore();
}
