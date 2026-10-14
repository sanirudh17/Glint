import {useEffect,useRef,useState} from 'react';
import type {ImageAnno} from './model';
export function useSourceImages(layers:ImageAnno[]) {
  const cache=useRef(new Map<string,HTMLImageElement>()),[images,setImages]=useState<Record<string,HTMLImageElement>>({});
  useEffect(()=>{let active=true;
    Promise.all(layers.map(async layer=>{let img=cache.current.get(layer.dataUrl);if(!img){img=await new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=layer.dataUrl;});cache.current.set(layer.dataUrl,img);}return [layer.id,img] as const;})).then(entries=>{if(active)setImages(Object.fromEntries(entries));}).catch(()=>{});
    return()=>{active=false;};
  },[layers]);
  return images;
}
