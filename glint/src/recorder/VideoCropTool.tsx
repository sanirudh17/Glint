import {useEffect,useRef,useState,type RefObject,type PointerEvent} from 'react';
import {Button} from '../components/ui';
import type {Crop} from '../editor/composition';
import {adjustVideoCrop,type CropGesture,type CropPoint,type CropHandle} from './cropGeometry';

const handles:{id:CropHandle;x:number;y:number;label:string;cursor:string}[]=[
 {id:'nw',x:0,y:0,label:'top left',cursor:'nwse-resize'},{id:'n',x:.5,y:0,label:'top',cursor:'ns-resize'},
 {id:'ne',x:1,y:0,label:'top right',cursor:'nesw-resize'},{id:'e',x:1,y:.5,label:'right',cursor:'ew-resize'},
 {id:'se',x:1,y:1,label:'bottom right',cursor:'nwse-resize'},{id:'s',x:.5,y:1,label:'bottom',cursor:'ns-resize'},
 {id:'sw',x:0,y:1,label:'bottom left',cursor:'nesw-resize'},{id:'w',x:0,y:.5,label:'left',cursor:'ew-resize'},
];
export function VideoCropTool({video,width,height,initialCrop,onApply,onCancel}:{video:RefObject<HTMLVideoElement|null>;width:number;height:number;initialCrop?:Crop;onApply:(crop:Crop)=>void;onCancel:()=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),image=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null);
 const gesture=useRef<{mode:CropGesture;start:CropPoint;original:Crop;before:Crop|null}|null>(null);
 const [box,setBox]=useState({width:0,height:0}),[rect,setRect]=useState<Crop|null>(initialCrop??null);
 const valid=!!rect&&rect.w>=2&&rect.h>=2;
 const apply=()=>{if(valid&&rect){const x=Math.round(rect.x),y=Math.round(rect.y);onApply({x,y,w:Math.min(width-x,Math.round(rect.w)),h:Math.min(height-y,Math.round(rect.h))});}};
 useEffect(()=>{const h=viewport.current;if(!h)return;const fit=()=>{const scale=Math.max(0,Math.min((h.clientWidth-24)/width,(h.clientHeight-24)/height));setBox({width:width*scale,height:height*scale});};const observer=new ResizeObserver(fit);observer.observe(h);fit();return()=>observer.disconnect();},[width,height]);
 useEffect(()=>{const c=canvas.current,v=video.current;if(c&&v&&v.readyState>=2){c.width=width;c.height=height;c.getContext('2d')?.drawImage(v,0,0,width,height);}image.current?.focus();},[video,width,height]);
 const point=(e:PointerEvent<HTMLDivElement>)=>{const r=image.current!.getBoundingClientRect();const snap=(v:number,size:number,source:number)=>v<=5?0:v>=size-5?source:v*source/size;return {x:snap(e.clientX-r.left,r.width,width),y:snap(e.clientY-r.top,r.height,height)};};
 return <div className="video-crop-tool" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();onCancel();}else if(e.key==='Enter'&&(e.target as HTMLElement).tagName!=='BUTTON'){e.preventDefault();apply();}}}>
  <header className="video-crop-header"><h2>Crop source video</h2><p>Drag to select. Move the selection or resize its edges.</p></header>
  <div className="video-crop-viewport" ref={viewport}><div ref={image} className="video-crop-image" style={box} tabIndex={0} role="group" aria-label="Draw video crop"
   onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();const mode=((e.target as HTMLElement).dataset.cropHandle??'draw') as CropGesture;gesture.current={mode,start:point(e),original:rect??{x:0,y:0,w:width,h:height},before:rect};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{const g=gesture.current;if(g)setRect(adjustVideoCrop(g.mode,g.original,g.start,point(e),width,height));}}
   onPointerUp={e=>{gesture.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
   onPointerCancel={()=>{if(gesture.current)setRect(gesture.current.before);gesture.current=null;}}
  ><canvas ref={canvas} aria-hidden="true"/>{rect&&<div className="video-crop-selection" data-crop-handle="move" tabIndex={0} role="group" aria-label="Move crop selection" style={{left:`${100*rect.x/width}%`,top:`${100*rect.y/height}%`,width:`${100*rect.w/width}%`,height:`${100*rect.h/height}%`}}
   onKeyDown={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();const step=e.shiftKey?10:1;setRect(adjustVideoCrop('move',rect,{x:0,y:0},{x:e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,y:e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0},width,height));}}
  >{handles.map(h=><button key={h.id} type="button" className="video-crop-handle" data-crop-handle={h.id} aria-label={`Resize crop ${h.label}`} style={{left:`${100*h.x}%`,top:`${100*h.y}%`,cursor:h.cursor}}
   onKeyDown={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?10:1;setRect(adjustVideoCrop(h.id,rect,{x:0,y:0},{x:e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,y:e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0},width,height));}}/>)}</div>}</div></div>
  <footer className="video-crop-actions"><Button size="sm" onClick={()=>setRect({x:0,y:0,w:width,h:height})}>Full frame</Button><output aria-live="polite">{rect?`${Math.round(rect.w)} × ${Math.round(rect.h)} px`:'No crop selected'}</output><Button onClick={onCancel}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={apply}>Apply crop</Button></footer>
 </div>;
}
