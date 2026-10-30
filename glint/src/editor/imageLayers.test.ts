import {describe,it,expect,beforeEach} from 'vitest';
import {newImageLayer,sideBySide} from './imageLayers';
import {duplicateAnnotation,nudgeAnnotation,reorder,DEFAULT_STYLE} from './model';
import {useEditorStore} from './useEditorStore';
describe('source image layers',()=>{
  it('fits an imported image without stretching and produces an unclipped side-by-side canvas',()=>{const layer=newImageLayer('data:test','Second',1600,800,800,600);expect(layer.w/layer.h).toBe(2);expect(layer.w).toBeLessThanOrEqual(600);const result=sideBySide(800,600,layer);expect(result.image.x).toBe(824);expect(result.canvasSize).toEqual({width:2024,height:600});});
  it('supports image duplication, movement, and ordering below annotations',()=>{const a=newImageLayer('data:a','A',200,200,800,600),b={...a,id:'b',dataUrl:'data:b'},rect={id:'r',type:'rect' as const,z:0,style:DEFAULT_STYLE,x:0,y:0,w:20,h:20};expect(nudgeAnnotation(a,10,-5)).toMatchObject({x:a.x+10,y:a.y-5});expect(duplicateAnnotation(a)).toMatchObject({dataUrl:a.dataUrl,x:a.x+12});expect(reorder([a,rect,b],a.id,'forward').map(v=>v.id)).toEqual(['b','r',a.id]);});
  beforeEach(()=>useEditorStore.getState().reset());
  it('keeps canvas expansion and layer pixels in undo and serialized documents',()=>{const s=useEditorStore.getState(),base={image:{} as HTMLImageElement,width:800,height:600,origin:'project',captureId:null};s.loadDoc(base,null,null);s.pushHistory();s.add(newImageLayer('data:embedded','Layer',100,100,800,600));s.setCanvasSize({width:1200,height:600});s.undo();expect(useEditorStore.getState().annotations).toEqual([]);expect(useEditorStore.getState().canvasSize).toBeNull();s.redo();const doc=JSON.parse(JSON.stringify(useEditorStore.getState()));s.loadDoc(base,doc,null);expect(useEditorStore.getState().canvasSize?.width).toBe(1200);expect(useEditorStore.getState().annotations[0]).toMatchObject({dataUrl:'data:embedded'});});
  it('restores the original canvas after deleting a side-by-side layer, including after reopen and undo',()=>{
    const s=useEditorStore.getState(),base={image:{} as HTMLImageElement,width:800,height:600,origin:'project',captureId:null};
    s.loadDoc(base,null,null);const layout=sideBySide(800,600,newImageLayer('data:a','Second',200,200,800,600));
    s.add(layout.image);s.setCanvasSize(layout.canvasSize,true);
    const doc=JSON.parse(JSON.stringify(useEditorStore.getState()));s.loadDoc(base,doc,null);s.pushHistory();s.remove(layout.image.id);
    expect(useEditorStore.getState().canvasSize).toBeNull();s.undo();expect(useEditorStore.getState().canvasSize).toEqual(layout.canvasSize);s.redo();expect(useEditorStore.getState().canvasSize).toBeNull();
    delete doc.canvasAutoFit;s.loadDoc(base,doc,null);s.remove(layout.image.id);expect(useEditorStore.getState().canvasSize).toBeNull();
  });
  it('keeps intentionally resized canvases and other image extents when an image is removed',()=>{
    const s=useEditorStore.getState(),base={image:{} as HTMLImageElement,width:800,height:600,origin:'project',captureId:null};s.loadDoc(base,null,null);
    const first=newImageLayer('data:a','First',100,100,800,600,900,0),second={...first,id:'second',x:1100};s.add(first);s.add(second);s.setCanvasSize({width:1300,height:600},true);s.remove(second.id);
    expect(useEditorStore.getState().canvasSize).toEqual({width:1000,height:600});s.setCanvasSize({width:1500,height:700});s.remove(first.id);expect(useEditorStore.getState().canvasSize).toEqual({width:1500,height:700});
  });
});
