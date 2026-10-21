import { cursorAt, drawCursorLayer, followSourcePoint, smoothPath } from "./studioCursor";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {useGradientPlate} from '../look/useGradientPlate';
import {useRasterImage} from '../look/useRasterImage';
import {watermarkPlacement} from '../look/sizing';
import { resolveRadiusPx } from "../editor/composition";
import { studioLayout } from "./studioLayout";
import type { StudioData } from "./studioModel";
import type { CamPlacement } from "./camOverlay";
import { toPixels } from "./camOverlay";
import { zoomAt } from "./studioEffects";
import { applyPreviewMasks } from "./studioMasks";
import {DEFAULT_MOTION,motionTimes} from './studioMotion';
import {Crosshair} from 'lucide-react';
import {previewFocus,type FocusPoint} from './studioFocus';
import {getGradient} from '../editor/gradients';
import {gradientStops} from '../look/gradientRender';
import {entrancePose,captionRaster} from './studioPolish';

export function StudioPreview({ studio:inputStudio, video, camVideo, cam, width, height, pickingFocus=false, onFocus,onAim,still=null,previewTime }: {
  previewTime?:number;
  still?:HTMLImageElement|null;
  studio: StudioData; video: RefObject<HTMLVideoElement | null>; camVideo: RefObject<HTMLVideoElement | null>;
  cam: CamPlacement | null; width: number; height: number;
  pickingFocus?:boolean;onFocus?:(point:{x:number;y:number})=>void;
  onAim?:(point:FocusPoint|null)=>void;
}) {
  const cameraOnly=cam?.visible&&cam.layout==='camera-only';
  const studio=useMemo(()=>{if(!cameraOnly)return inputStudio;const output=studioLayout(width,height,inputStudio.project.crop,inputStudio.project.look);return {...inputStudio,project:{...inputStudio.project,crop:null,look:{...inputStudio.project.look,outputSize:{width:output.width,height:output.height}},zoomSegments:[],masks:[],cursor:{...inputStudio.project.cursor,visible:false,clicks:false,keystrokes:false}}};},[inputStudio,cameraOnly,width,height]);
  const path = useMemo(() => smoothPath(studio.events.events, studio.project.cursor.smoothing), [studio.events, studio.project.cursor.smoothing]);
  const effectEvents = useMemo(() => ({ ...studio.events, events: studio.events.events.filter((e) => e.kind !== "cursor") }), [studio.events]);
  const ref = useRef<HTMLCanvasElement>(null);
  const captionImages=useRef(new Map<string,HTMLImageElement>());
  const [marker,setMarker]=useState<{left:number;top:number;point:FocusPoint}|null>(null);
  useEffect(()=>{setMarker(null);if(pickingFocus)ref.current?.focus({preventScroll:true});},[pickingFocus]);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const background = studio.project.look.background;
  const watermark=useRasterImage(studio.project.look.watermark?.dataUrl);
  const plateLayout=studioLayout(width,height,studio.project.crop,studio.project.look,960);
  const gradient=useGradientPlate(studio.project.look.enabled&&background.type==='gradient'?background:null,plateLayout.width,plateLayout.height);
  const gradientPlate=gradient.canvas;
  const drift=useMemo(()=>{if(background.type!=='gradient'||!background.animationSeconds)return null;const stops=gradientStops(background);return {...background,animationSeconds:undefined,angleDeg:((background.angleDeg??getGradient(background.gradientId).angleDeg)+30)%360,...(background.kind==='radial'?{stops:stops.map((s,i)=>({...s,color:stops[stops.length-1-i].color}))}:{})};},[background]);
  const alternate=useGradientPlate(drift,plateLayout.width,plateLayout.height).canvas;
  useEffect(() => {
    setImage(null); if (background.type !== "image" || !background.dataUrl) return;
    let active = true; const img = new Image(); img.onload = () => { if (active) setImage(img); }; img.src = background.dataUrl;
    return () => { active = false; };
  }, [background]);
  useEffect(() => {
    let raf = 0;
    const maskedSource=document.createElement('canvas'),maskScratch=document.createElement('canvas'),stillBackground=document.createElement('canvas');
    let maskedTime=NaN,maskedCamTime=NaN;
    const tick = () => {
      const canvas = ref.current, player = video.current, v = still ?? player;
      const time=still?(previewTime??0):player?.currentTime??0;
      if (canvas && v && (still?.complete || player && player.readyState >= 2 && !player.seeking)) {
        const { look, crop } = studio.project;
        const { layout: l, scale, width: w, height: h } = studioLayout(width, height, crop, look, 960);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext("2d")!;
        ctx.resetTransform(); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); ctx.scale(scale, scale);
        if (look.enabled && background.type === "solid") { ctx.fillStyle = background.color; ctx.fillRect(0, 0, l.compositionW, l.compositionH); }
        if (look.enabled && background.type === "gradient") {
          if(gradientPlate)ctx.drawImage(gradientPlate,0,0,l.compositionW,l.compositionH);
          if(alternate&&background.animationSeconds){ctx.save();ctx.globalAlpha=(1-Math.cos(time*Math.PI*2/background.animationSeconds))/2;ctx.drawImage(alternate,0,0,l.compositionW,l.compositionH);ctx.restore();}
        }
        if (look.enabled && background.type === "image" && image) {
          const cover = Math.max(l.compositionW / image.width, l.compositionH / image.height);
          ctx.drawImage(image, 0, 0, image.width * cover, image.height * cover);
        }
        if(still){stillBackground.width=w;stillBackground.height=h;stillBackground.getContext('2d')!.drawImage(canvas,0,0);}
        const radius = look.enabled ? resolveRadiusPx(look.radius, l.contentW, l.contentH) : 0;
        const top = l.contentY - l.chromeH, cardH = l.contentH + l.chromeH;
        ctx.save();
        if (look.enabled && look.shadow > 0) { // taste-skill-ignore: user-selected media framing effect
          const edge = Math.max(l.contentW, l.contentH), t = look.shadow / 100; // taste-skill-ignore: user-selected video framing shadow
          ctx.shadowColor = look.shadowColor ?? "#000"; ctx.shadowBlur = (0.02 + t * .1) * edge * scale; ctx.shadowOffsetY = (.01 + t * .05) * edge * scale; // taste-skill-ignore: rendered media effect
          ctx.globalAlpha = .2 + t * .5;
        }
        ctx.beginPath(); ctx.roundRect(l.contentX, top, l.contentW, cardH, radius); ctx.fillStyle = "#000"; ctx.fill(); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.roundRect(l.contentX, top, l.contentW, cardH, radius); ctx.clip();
        // Transparent images reveal the current background, as in native export.
        if(still)ctx.drawImage(stillBackground,0,0,l.compositionW,l.compositionH);
        const cursor = followSourcePoint(path,time,studio.events,width,height);
        const view = zoomAt(studio.project.zoomSegments, time, { x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH },width,height,cursor);
        const previous=zoomAt(studio.project.zoomSegments,Math.max(0,time-1/60),{x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH},width,height,followSourcePoint(path,Math.max(0,time-1/60),studio.events,width,height));
        const motion=studio.project.motionBlur??DEFAULT_MOTION;
        const times=motionTimes(motion,time,Math.abs(view.x-previous.x)+Math.abs(view.y-previous.y)+Math.abs(view.w-previous.w)/2+Math.abs(view.h-previous.h)/2);
        const entrance=entrancePose(studio.project.contentMotion,time,studio.project.contentMotionSeconds??.6);
        ctx.save(); ctx.translate(l.contentX+l.contentW/2+entrance.x*l.contentW,l.contentY+l.contentH/2+entrance.y*l.contentH);ctx.scale(entrance.scale,entrance.scale);ctx.translate(-l.contentW/2,-l.contentH/2);ctx.globalAlpha=entrance.opacity; ctx.scale(l.contentW/view.w,l.contentH/view.h);
        const hasMasks=studio.project.masks.length>0;
        const useOverlay=cam?.layout!=='side-by-side'&&cam?.layout!=='camera-only';
        const sourceCanvas=cameraOnly||hasMasks||motion.enabled&&cam?.visible&&useOverlay;
        const cv=camVideo.current;
        const camTime=cam?.visible&&cv&&cv.readyState>=2&&!cv.seeking?cv.currentTime:-1;
        if(sourceCanvas&&(maskedTime!==time||maskedCamTime!==camTime)) {
          maskedSource.width=width;maskedSource.height=height;const source=maskedSource.getContext('2d')!;
          if(cameraOnly){source.fillStyle='#000';source.fillRect(0,0,width,height);if(cam&&cv&&camTime>=0)paintCamera(source,{...cam,x:0,y:0,diameter:1,shape:'rect'},cv,width,height);}else source.drawImage(v,0,0,width,height);
          if(cam&&cv&&camTime>=0&&useOverlay)paintCamera(source,cam,cv,width,height);
          applyPreviewMasks(source,studio.project.masks,Math.min(time,Math.max(0,(player?.duration??1)-1e-7)),width,height,maskScratch);
          maskedTime=time;
          maskedCamTime=camTime;
        }
        if(times.length>1) {
          for(const index of [2,1,0]) {
            const time=times[index],pose=zoomAt(studio.project.zoomSegments,time,{x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH},width,height,followSourcePoint(path,time,studio.events,width,height));
            ctx.globalAlpha=index===2?1:index===1?.75:.6;
            ctx.drawImage(sourceCanvas?maskedSource:v,pose.x,pose.y,pose.w,pose.h,0,0,view.w,view.h);
          }ctx.globalAlpha=1;
        } else ctx.drawImage(sourceCanvas?maskedSource:v, view.x, view.y, view.w, view.h, 0, 0, view.w, view.h);
        if (!sourceCanvas && cam?.visible && useOverlay && camVideo.current && camVideo.current.readyState >= 2) {
          const box = toPixels(cam, width, height, width / height);
          ctx.save(); ctx.translate(box.x - view.x, box.y - view.y);
          ctx.beginPath(); ctx.roundRect(0, 0, box.w, box.h, cam.shape === "circle" ? box.w / 2 : cam.shape === "rect" ? 0 : box.w * .14); ctx.clip();
          const cv = camVideo.current, ratio = box.w / box.h, native = cv.videoWidth / cv.videoHeight;
          const sw = native > ratio ? cv.videoHeight * ratio : cv.videoWidth, sh = native > ratio ? cv.videoHeight : cv.videoWidth / ratio;
          ctx.drawImage(cv, (cv.videoWidth - sw) / 2, (cv.videoHeight - sh) / 2, sw, sh, 0, 0, box.w, box.h); ctx.restore();
        }
        const cursorLayout={ ...l,contentX:0,contentY:0,contentW:view.w,contentH:view.h,cropX:view.x,cropY:view.y };
        const a=cursorAt(path,time),b=cursorAt(path,Math.max(0,time-1/60));
        const movement=a&&b?Math.hypot(a.x-b.x,a.y-b.y)*width/studio.events.geometry.width:0;
        if(motion.enabled&&motion.intensity>0&&movement>8) {
          for(const [offset,alpha] of [[motion.intensity/60,.1],[motion.intensity/120,.25]]) {
            ctx.save();ctx.globalAlpha=alpha;drawCursorLayer(ctx,Math.max(0,time-offset),path,effectEvents,{...studio.project.cursor,clicks:false,keystrokes:false},cursorLayout,width,height);ctx.restore();
          }
        }
        drawCursorLayer(ctx, time, path, effectEvents, studio.project.cursor, cursorLayout, width, height);
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
        if(look.enabled&&look.watermark&&watermark) {const b=watermarkPlacement(l.compositionW,l.compositionH,look.watermark);ctx.save();ctx.globalAlpha=look.watermark.opacity;ctx.drawImage(watermark,b.x,b.y,b.w,b.h);ctx.restore();}
        const caption=studio.project.captionsEnabled?studio.project.captions?.find(c=>c.start<=time&&time<c.end):null;
        if(caption){const key=caption.id+caption.text;let image=captionImages.current.get(key);if(!image){image=new Image();image.src=caption.raster??captionRaster(caption.text);captionImages.current.set(key,image);if(captionImages.current.size>4)captionImages.current.delete(captionImages.current.keys().next().value!);}if(image.complete&&image.naturalWidth){const margin=Math.min(Math.max(12,Math.min(l.compositionW,l.compositionH)*.025),l.compositionW/4,l.compositionH/4);const width=Math.min(l.compositionW-margin*2,l.compositionH*.18*1280/170),height=width*170/1280;ctx.drawImage(image,(l.compositionW-width)/2,l.compositionH-margin-height,width,height);}}
        if(cam?.visible&&cam.layout==='side-by-side'&&cv&&cv.readyState>=2){
          const copy=maskScratch;copy.width=w;copy.height=h;copy.getContext('2d')!.drawImage(canvas,0,0);ctx.save();ctx.resetTransform();ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
          const left=cam.layout==='side-by-side'?Math.floor(w/4)*2:0,boxW=w-left;
          if(left){const factor=Math.min(left/w,h/h),sw=w*factor,sh=h*factor;ctx.drawImage(copy,(left-sw)/2,(h-sh)/2,sw,sh);}
          const ratio=boxW/h,native=cv.videoWidth/cv.videoHeight,sw=native>ratio?cv.videoHeight*ratio:cv.videoWidth,sh=native>ratio?cv.videoHeight:cv.videoWidth/ratio;
          ctx.drawImage(cv,(cv.videoWidth-sw)/2,(cv.videoHeight-sh)/2,sw,sh,left,0,boxW,h);ctx.restore();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [studio, video, camVideo, cam, width, height, background, image, path, effectEvents, gradientPlate,alternate,watermark,still,previewTime]);
  const pointAt=(clientX:number,clientY:number)=>{
    const canvas=ref.current;if(!canvas||video.current?.seeking)return null;
    const rect=canvas.getBoundingClientRect();
    const {layout:l,scale}=studioLayout(width,height,studio.project.crop,studio.project.look,960);
    const t=video.current?.currentTime??0;
    const view=zoomAt(studio.project.zoomSegments,t,{x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH},width,height,followSourcePoint(path,t,studio.events,width,height));
    return previewFocus({x:clientX,y:clientY},rect,canvas,l,scale,view,{width,height});
  };
  return <><canvas ref={ref} className={`studio-preview${pickingFocus?' is-picking':''}`} aria-label="Studio video preview" tabIndex={pickingFocus?0:undefined} data-editor-control={pickingFocus?true:undefined}
    onPointerMove={e=>{if(!pickingFocus)return;const point=pointAt(e.clientX,e.clientY);onAim?.(point);const r=e.currentTarget.getBoundingClientRect();setMarker(point?{left:e.clientX-r.x,top:e.clientY-r.y,point}:null);}}
    onPointerLeave={()=>{if(pickingFocus){setMarker(null);onAim?.(null);}}}
    onClick={e=>{if(!pickingFocus)return;const point=pointAt(e.clientX,e.clientY);if(point)onFocus?.(point);}}
    onKeyDown={e=>{if(pickingFocus&&e.key==='Enter'&&marker){e.preventDefault();onFocus?.(marker.point);}}}/>
    {pickingFocus&&marker&&<span className="studio-focus-target" style={{left:marker.left,top:marker.top}} aria-hidden><Crosshair size={22} strokeWidth={1.6}/></span>}
    {pickingFocus&&<span className="studio-preview-instruction">Move to aim · Click to apply · Esc to cancel</span>}</>;
}

function paintCamera(ctx:CanvasRenderingContext2D,cam:CamPlacement,video:HTMLVideoElement,width:number,height:number) {
  const box=toPixels(cam,width,height,width/height);ctx.save();ctx.translate(box.x,box.y);
  ctx.beginPath();ctx.roundRect(0,0,box.w,box.h,cam.shape==='circle'?box.w/2:cam.shape==='rect'?0:box.w*.14);ctx.clip();
  const ratio=box.w/box.h,native=video.videoWidth/video.videoHeight;
  const sw=native>ratio?video.videoHeight*ratio:video.videoWidth,sh=native>ratio?video.videoHeight:video.videoWidth/ratio;
  ctx.drawImage(video,(video.videoWidth-sw)/2,(video.videoHeight-sh)/2,sw,sh,0,0,box.w,box.h);ctx.restore();
}
