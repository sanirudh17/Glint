import {useState} from 'react';
import {ImagePlus,ChevronUp,ChevronDown,Trash2} from 'lucide-react';
import {useEditorStore} from '../../editor/useEditorStore';
import {NumberInput} from '../../components/ui';
import {newImageLayer,sideBySide,readImageFile} from '../../editor/imageLayers';
import type {ImageAnno} from '../../editor/model';

export function addLayer(data:{dataUrl:string;width:number;height:number;name:string},point?:{x:number;y:number}) {
  const s=useEditorStore.getState();if(!s.base)return;
  const size=s.canvasSize??s.base,layer=newImageLayer(data.dataUrl,data.name,data.width,data.height,size.width,size.height,point?.x,point?.y);s.pushHistory();s.add(layer);s.setTool('select');s.select(layer.id);
}
export function ImagesPanel(){
  const s=useEditorStore(),[error,setError]=useState('');
  if(!s.base)return null;
  const images=s.annotations.filter((a):a is ImageAnno=>a.type==='image');
  const selected=images.find(a=>a.id===s.selectedId),size=s.canvasSize??s.base;
  const patch=(p:Partial<ImageAnno>)=>{if(selected){s.pushHistory();s.update(selected.id,p);}};
  return <aside className="frame-panel" aria-label="Images and canvas" data-editor-control>
    <h3 className="studio-section-title">Images & canvas</h3>
    <label className="look-image-picker"><ImagePlus size={16}/>Add image layer<input type="file" aria-label="Add image layer" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(file)try{addLayer(await readImageFile(file));setError('');}catch(error){setError(String(error));}}}/></label>
    <p className="look-hint">Drop an image onto the canvas, then drag or resize it. Image layers stay below annotations.</p>
    <div className="look-row"><span className="look-label">Canvas width</span><div className="look-control"><NumberInput ariaLabel="Canvas width" min={16} max={8192} value={size.width} onChange={width=>{if(width!==size.width){s.pushHistory();s.setCanvasSize({width,height:size.height});}}}/></div></div>
    <div className="look-row"><span className="look-label">Canvas height</span><div className="look-control"><NumberInput ariaLabel="Canvas height" min={16} max={8192} value={size.height} onChange={height=>{if(height!==size.height){s.pushHistory();s.setCanvasSize({height,width:size.width});}}}/></div></div>
    <p className="look-hint">Increasing the canvas adds space to the right and bottom. Export size changes resolution without cropping.</p>
    <div className="editor-image-list" role="list" aria-label="Image layers">{[...images].reverse().map(image=><button key={image.id} className={`g-btn g-btn-subtle g-btn-sm${s.selectedId===image.id?' is-active':''}`} aria-pressed={s.selectedId===image.id} onClick={()=>{s.setTool('select');s.select(image.id);}}>{image.name}</button>)}</div>
    {selected&&<>
      {(['x','y','w','h'] as const).map(key=><div className="look-row" key={key}><span className="look-label">{({x:'Left',y:'Top',w:'Width',h:'Height'})[key]}</span><div className="look-control"><NumberInput ariaLabel={`Image ${key}`} min={key==='w'||key==='h'?1:-8192} max={8192} value={selected[key]} onChange={value=>{if(value!==selected[key])patch({[key]:value});}}/></div></div>)}
      <button className="g-btn g-btn-subtle g-btn-sm" onClick={()=>{const result=sideBySide(s.base!.width,s.base!.height,selected);if(result.canvasSize.width>8192){setError('This layout exceeds 8,192 px. Resize the image first.');return;}s.pushHistory();s.update(selected.id,result.image);s.setCanvasSize(result.canvasSize);}}>Place side by side</button>
      <div className="editor-layer-actions"><button className="g-btn g-btn-subtle g-btn-sm" aria-label="Bring image forward" disabled={images[images.length-1]?.id===selected.id} onClick={()=>s.bringForward(selected.id)}><ChevronUp size={16}/></button><button className="g-btn g-btn-subtle g-btn-sm" aria-label="Send image backward" disabled={images[0]?.id===selected.id} onClick={()=>s.sendBackward(selected.id)}><ChevronDown size={16}/></button><button className="g-btn g-btn-subtle g-btn-sm" aria-label="Delete image layer" onClick={()=>{s.pushHistory();s.remove(selected.id);}}><Trash2 size={16}/></button></div>
    </>}
    {error&&<p className="look-error" role="alert">{error}</p>}
  </aside>;
}
