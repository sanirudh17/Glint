import {prepareAnnotations,type VideoAnnotation} from "./videoAnnotations";
import {DEFAULT_LOOK,cloneLook,type LookConfig} from '../look/model';
import {DEFAULT_CURSOR,type StudioData} from './studioModel';
import type {Entrance} from './studioPolish';
export interface SceneMedia {path:string;kind:'video'|'image';width:number;height:number;duration:number;hasAudio:boolean}
export interface Scene {
  id:string;kind:'video'|'image'|'title';media:SceneMedia|null;start:number;end:number;duration:number;
  title:string;titleColor:string;titleStart:string;titleEnd:string;titleSize:number;raster:string|null;
  transition:{kind:'cut'|'crossfade'|'slide';duration:number};
  annotations?:VideoAnnotation[];
  entrance?:Entrance;
  shape?:'none'|'line'|'circle'|'rectangle';
}
export interface SceneProject {version:1;width:number;height:number;look:LookConfig;scenes:Scene[]}
export const emptySceneProject=():SceneProject=>({version:1,width:1280,height:720,look:{...cloneLook(DEFAULT_LOOK),enabled:true,aspect:'16:9',padding:32},scenes:[]});
export function newScene(media?:SceneMedia):Scene {
 return {id:crypto.randomUUID(),kind:media?.kind??'title',media:media??null,start:0,end:Math.min(media?.duration??0,900),duration:3,title:'Your title',titleColor:'#ffffff',titleStart:'#253b75',titleEnd:'#6554b8',titleSize:64,raster:null,transition:{kind:'cut',duration:.3}};
}
export const sceneSeconds=(s:Scene)=>s.kind==='video'?s.end-s.start:s.duration;
export function sceneOverlap(project:SceneProject,index:number):number {
 if(index===0||project.scenes[index].transition.kind==='cut')return 0;
 return Math.min(project.scenes[index].transition.duration,sceneSeconds(project.scenes[index-1])/2,sceneSeconds(project.scenes[index])/2);
}
export function sceneTimeline(project:SceneProject) {
 let end=0;
 return project.scenes.map((scene,index)=>{const overlap=sceneOverlap(project,index),start=end-overlap;end=start+sceneSeconds(scene);return {scene,index,start,end,overlap};});
}
export function projectSeconds(project:SceneProject){const rows=sceneTimeline(project);return rows[rows.length-1]?.end??0;}
export function reorderScene(project:SceneProject,id:string,direction:-1|1):SceneProject {
 const scenes=[...project.scenes],i=scenes.findIndex(s=>s.id===id),next=i+direction;
 if(i<0||next<0||next>=scenes.length)return project;
 [scenes[i],scenes[next]]=[scenes[next],scenes[i]];return {...project,scenes};
}
export function activeScenes(project:SceneProject,time:number) {
 const timeline=sceneTimeline(project),last=timeline[timeline.length-1];
 const t=Math.max(0,Math.min(time,Math.max(0,(last?.end??0)-1e-6)));
 return timeline.filter(s=>t>=s.start&&t<s.end).map(s=>({...s,time:t-s.start,progress:s.overlap>0?Math.min(1,(t-s.start)/s.overlap):1}));
}
export function effectiveSceneLook(project:SceneProject):LookConfig {
 const look=project.look.enabled?project.look:{...cloneLook(DEFAULT_LOOK),enabled:true,background:{type:'solid' as const,color:'#000000'},padding:0,radius:0,shadow:0};
 return {...look,aspect:'auto',outputSize:{width:project.width,height:project.height}};
}
export function sceneStudio(project:SceneProject,scene:Scene):StudioData {
 const width=scene.media?.width??project.width,height=scene.media?.height??project.height;
 return {project:{version:2,look:effectiveSceneLook(project),cursor:{...DEFAULT_CURSOR,visible:false,clicks:false,keystrokes:false},crop:null,clips:[{id:1,start:scene.start,end:scene.kind==='video'?scene.end:scene.duration,speed:1,kept:true,order:0}],fadeIn:0,fadeOut:0,cam:null,zoomSegments:[],masks:[],annotations:scene.annotations??[],contentMotion:scene.kind==='title'?scene.entrance:undefined,contentMotionSeconds:Math.min(.6,scene.duration/2)},events:{version:1,geometry:{x:0,y:0,width,height,monitorX:0,monitorY:0,monitorWidth:width,monitorHeight:height,dpiScale:1},events:[]}};
}
/** Raster titles with the app's installed font, keeping editable text in the document. */
export function titleRaster(scene:Scene,width:number,height:number):string {
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;
 const gradient=ctx.createLinearGradient(0,0,width,height);gradient.addColorStop(0,scene.titleStart);gradient.addColorStop(1,scene.titleEnd);ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
 if(scene.shape&&scene.shape!=='none'){ctx.save();ctx.globalAlpha=.18;ctx.fillStyle=scene.titleColor;ctx.strokeStyle=scene.titleColor;ctx.lineWidth=height*.012;ctx.beginPath();if(scene.shape==='circle'){ctx.arc(width*.8,height*.5,height*.32,0,Math.PI*2);ctx.fill();}else if(scene.shape==='rectangle'){ctx.roundRect(width*.12,height*.2,width*.76,height*.6,height*.04);ctx.stroke();}else{ctx.moveTo(width*.25,height*.72);ctx.lineTo(width*.75,height*.72);ctx.stroke();}ctx.restore();}
 let size=scene.titleSize*width/1280,lines:string[]=[];
 const wrap=()=>{ctx.font=`600 ${size}px Manrope, "Segoe UI", sans-serif`;lines=[];for(const paragraph of scene.title.split('\n')){let line='';for(const word of paragraph.split(/\s+/)){const candidate=line?`${line} ${word}`:word;if(ctx.measureText(candidate).width>width*.8&&line){lines.push(line);line=word;}else{line=candidate;}}lines.push(line);}};
 wrap();while(size>8&&(lines.length*size*1.3>height*.75||lines.some(l=>ctx.measureText(l).width>width*.9))){size*=.95;wrap();}
 ctx.fillStyle=scene.titleColor;ctx.textAlign='center';ctx.textBaseline='middle';lines.forEach((line,i)=>ctx.fillText(line,width/2,height/2+(i-(lines.length-1)/2)*size*1.3));return canvas.toDataURL('image/png');
}
export async function prepareSceneProject(project:SceneProject):Promise<SceneProject>{await document.fonts.ready;return {...project,scenes:await Promise.all(project.scenes.map(async s=>({...s,...(s.kind==='title'?{raster:titleRaster(s,project.width,project.height)}:{}),annotations:await prepareAnnotations(s.annotations,project.width/project.height)})))};}
