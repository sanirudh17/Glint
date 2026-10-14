import type { LookConfig } from './model';
export const OUTPUT_SIZES=[
  {id:'og',label:'OG image · 1200 × 630',width:1200,height:630},
  {id:'square',label:'Square post · 1080 × 1080',width:1080,height:1080},
  {id:'portrait',label:'Portrait post · 1080 × 1350',width:1080,height:1350},
  {id:'story',label:'Story · 1080 × 1920',width:1080,height:1920},
  {id:'app-store',label:'App Store · 1290 × 2796',width:1290,height:2796},
  {id:'landscape',label:'Landscape · 1920 × 1080',width:1920,height:1080},
];
/** Equal margins around the full card. Fixed-ratio/size constraints are cleared. */
export function autoBalance(width:number,height:number):Partial<LookConfig> {
  return {enabled:true,aspect:'auto',outputSize:undefined,padding:Math.round(40*Math.min(width,height)/Math.max(width,height))};
}
export function watermarkPlacement(width:number,height:number,wm:NonNullable<LookConfig['watermark']>) {
  const margin=Math.max(12,Math.min(width,height)*.025),h=Math.max(12,Math.min(width,height)*.035);
  const w=Math.min(width-margin*2,h*wm.width/wm.height);
  const resolvedH=w*wm.height/wm.width;
  return {x:wm.position==='bottom-left'?margin:width-margin-w,y:height-margin-resolvedH,w,h:resolvedH};
}
export function watermarkImage(text:string,color:string):Pick<NonNullable<LookConfig['watermark']>,'dataUrl'|'width'|'height'> {
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
  ctx.font='500 32px Manrope';canvas.width=Math.max(1,Math.ceil(ctx.measureText(text).width)+8);canvas.height=48;
  ctx.font='500 32px Manrope';ctx.fillStyle=color;ctx.textBaseline='middle';ctx.fillText(text,4,24);
  return {dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
}
