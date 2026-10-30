import {gradientPixels,type GradientBackground} from './gradientRender';
const scope=self as unknown as {onmessage:((event:MessageEvent<{id:number;key:string;bg:GradientBackground;w:number;h:number}>)=>void)|null;postMessage:(value:unknown,transfer:Transferable[])=>void};
scope.onmessage=event=>{
  const {id,key,bg,w,h}=event.data;
  const pixels=gradientPixels(bg,w,h);
  scope.postMessage({id,key,w,h,pixels},[pixels.buffer as ArrayBuffer]);
};
