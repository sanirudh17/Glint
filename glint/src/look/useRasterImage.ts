import {useEffect,useState} from 'react';
export function useRasterImage(url?:string):HTMLImageElement|null {
  const [image,setImage]=useState<HTMLImageElement|null>(null);
  useEffect(()=>{setImage(null);if(!url)return;let active=true;const img=new Image();img.onload=()=>{if(active)setImage(img);};img.src=url;return()=>{active=false;};},[url]);
  return image;
}
