import {DEFAULT_STYLE,newId,type ImageAnno} from './model';
export function newImageLayer(dataUrl:string,name:string,width:number,height:number,canvasW:number,canvasH:number,x?:number,y?:number):ImageAnno {
  const scale=Math.min(1,canvasW*.75/width,canvasH*.75/height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  return {id:newId(),type:'image',z:0,style:{...DEFAULT_STYLE},dataUrl,name,x:x??Math.round((canvasW-w)/2),y:y??Math.round((canvasH-h)/2),w,h};
}
export function sideBySide(width:number,height:number,image:ImageAnno){
  const gap=Math.round(Math.min(width,height)*.04),w=Math.round(height*image.w/image.h);
  return {image:{...image,x:width+gap,y:0,w,h:height},canvasSize:{width:width+gap+w,height}};
}
export async function readImageFile(file:File):Promise<{dataUrl:string;width:number;height:number;name:string}>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG or WebP image.');
  if(file.size>15*1024*1024)throw new Error('Choose an image smaller than 15 MB.');
  const dataUrl=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('This image could not be read.'));r.readAsDataURL(file);});
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('This image could not be decoded.'));i.src=dataUrl;});
  if(image.width>8192||image.height>8192)throw new Error('Choose an image with each side under 8,192 px.');
  return {dataUrl,width:image.width,height:image.height,name:file.name};
}
