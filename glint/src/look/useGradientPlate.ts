import {useEffect,useRef,useState} from 'react';
import type {GradientBackground} from './gradientRender';

/** Keep only the newest queued edit. Expensive grain/mesh work stays off the UI thread. */
export function useGradientPlate(bg:GradientBackground|null,width:number,height:number){
  const sequence=useRef(0),worker=useRef<Worker|null>(null),busy=useRef(false);
  const key=bg?JSON.stringify(bg)+':'+Math.round(width)+':'+Math.round(height):'';
  const pending=useRef<{id:number;key:string;bg:GradientBackground;w:number;h:number}|null>(null);
  const [result,setResult]=useState<{id:number;key:string;canvas:HTMLCanvasElement}|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    busy.current=false;pending.current=null;
    const w=new Worker(new URL('./gradient.worker.ts',import.meta.url),{type:'module'});worker.current=w;
    w.onmessage=event=>{
      const {id,key,w:width,h:height,pixels}=event.data;busy.current=false;
      if(id===sequence.current){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.putImageData(new ImageData(pixels,width,height),0,0);setResult({id,key,canvas});}
      if(pending.current){const request=pending.current;pending.current=null;busy.current=true;w.postMessage(request);}
    };
    w.onerror=()=>{busy.current=false;pending.current=null;setError('This background could not be rendered. Choose Solid or reopen the editor.');};
    return()=>{w.terminate();worker.current=null;busy.current=false;pending.current=null;};
  },[]);
  useEffect(()=>{
    sequence.current++;pending.current=null;setError('');
    if(!bg)return;
    const request={id:sequence.current,key,bg,w:Math.round(width),h:Math.round(height)};
    if(busy.current)pending.current=request;else{busy.current=true;worker.current?.postMessage(request);}
  },[key]);
  return {canvas:result?.canvas??null,pending:!!bg&&result?.key!==key,error};
}
