import type Konva from 'konva';
import {computeLayout} from './composition';
import {useEditorStore} from './useEditorStore';
export interface PrivacySuggestion {kind:string;x:number;y:number;w:number;h:number}
export const privacyCellSize=(w:number,h:number)=>Math.max(24,Math.ceil(Math.min(w,h)/3));
export const opaqueRedactionColor=(color:string)=>/^#[0-9a-f]{6}$/i.test(color)?color:'#111111';
/** Coarse averaging discards glyph detail before any blur is applied. */
export function privacyPixels(source:Uint8ClampedArray,width:number,height:number):Uint8ClampedArray{
  const out=new Uint8ClampedArray(source.length),cell=privacyCellSize(width,height);
  for(let top=0;top<height;top+=cell)for(let left=0;left<width;left+=cell){
    const right=Math.min(width,left+cell),bottom=Math.min(height,top+cell),count=(right-left)*(bottom-top);let r=0,g=0,b=0;
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=(y*width+x)*4;r+=source[i];g+=source[i+1];b+=source[i+2];}
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=(y*width+x)*4;out[i]=Math.round(r/count);out[i+1]=Math.round(g/count);out[i+2]=Math.round(b/count);out[i+3]=255;}
  }return out;
}
/** Suggestions and selection handles are UI only, never part of a scan or export. */
export function withoutEditorChrome<T>(stage:Konva.Stage,render:()=>T):T{
  const nodes=[...stage.find('Transformer'),...stage.find('.privacy-suggestions')],visibility=nodes.map(n=>n.visible());
  nodes.forEach(n=>n.hide());try{return render();}finally{nodes.forEach((n,i)=>{n.visible(visibility[i]);n.getLayer()?.batchDraw();});}
}
export function privacyScanImage(stage:Konva.Stage){
  const s=useEditorStore.getState();if(!s.base)throw Error('Open a screenshot first.');
  const layout=computeLayout(s.canvasSize?.width??s.base.width,s.canvasSize?.height??s.base.height,s.crop,s.frame);
  const scale=Math.min(1,4096/Math.max(layout.contentW,layout.contentH));
  const canvas=withoutEditorChrome(stage,()=>stage.toCanvas({x:layout.contentX,y:layout.contentY,width:layout.contentW,height:layout.contentH,pixelRatio:scale}));
  return {pngBase64:canvas.toDataURL('image/png').split(',')[1],scaleX:canvas.width/layout.contentW,scaleY:canvas.height/layout.contentH,x:layout.cropX,y:layout.cropY};
}
