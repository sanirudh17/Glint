import { useState } from "react";
import { Select, ColorControl, ControlDisclosure } from "../components/ui";
import { GRADIENTS, cssGradient, getGradient, type GradientStop } from "../editor/gradients";
import { gradientStops, threeStops, type GradientBackground } from "./gradientRender";
import { LookSlider } from "./LookControls";

export function GradientControls({ background:bg, onChange, checkpoint, onSample }: {
  background:GradientBackground;onChange:(bg:GradientBackground)=>void;checkpoint:()=>void;onSample?:()=>GradientStop[];
}) {
  const [category,setCategory]=useState(getGradient(bg.gradientId).category??'vivid');
  const stops=gradientStops(bg);
  const change=(patch:Partial<GradientBackground>)=>{checkpoint();onChange({...bg,...patch});};
  return <>
    <div className="look-row"><span className="look-label">Collection</span><div className="look-control"><Select portal ariaLabel="Gradient collection" value={category}
      options={[{value:'vivid',label:'Vivid'},{value:'soft',label:'Soft'},{value:'dark',label:'Dark'},{value:'pastel',label:'Pastel'},{value:'neutral',label:'Neutral'}]} onChange={setCategory}/></div></div>
    <div className="look-gradient-grid">{GRADIENTS.filter(g=>g.category===category).map(g=><button key={g.id} type="button" title={g.label} aria-label={g.label} aria-pressed={bg.gradientId===g.id&&!bg.stops}
      className={`look-gradient${bg.gradientId===g.id&&!bg.stops?' is-active':''}`} style={{background:cssGradient(g)}} // taste-skill-ignore: media gradient sample
      onClick={()=>{checkpoint();onChange({...bg,gradientId:g.id,stops:undefined});}}/>)}</div>
    <ControlDisclosure title="Customize gradient">
      <div className="look-row"><span className="look-label">Style</span><div className="look-control"><Select portal ariaLabel="Gradient style" value={bg.kind??'linear'} options={['linear','radial','conic','mesh'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))} onChange={kind=>change({kind:kind as GradientBackground['kind']})}/></div></div>
      <LookSlider label="Angle" ariaLabel="Gradient angle" value={bg.angleDeg??getGradient(bg.gradientId).angleDeg} max={360} unit="°" checkpoint={checkpoint} onChange={angleDeg=>onChange({...bg,angleDeg})}/>
      <div className="look-row"><span className="look-label">Colors</span><div className="look-control"><Select portal ariaLabel="Gradient color count" value={String(stops.length)} options={[{value:'2',label:'Two colors'},{value:'3',label:'Three colors'}]} onChange={count=>change({stops:threeStops(stops,Number(count))})}/></div></div>
      {stops.map((stop,i)=><div className="look-row" key={i}><span className="look-label">{i===0?'Start':i===stops.length-1?'End':'Middle'}</span><div className="look-control"><ColorControl ariaLabel={`Gradient color ${i+1}`} value={stop.color} onChange={color=>change({stops:stops.map((s,k)=>k===i?{...s,color}:s)})}/></div></div>)}
      <LookSlider label="Grain" ariaLabel="Gradient grain" value={(bg.grain??0)*100} unit="%" checkpoint={checkpoint} onChange={grain=>onChange({...bg,grain:grain/100})}/>
      {onSample&&<button type="button" className="g-btn g-btn-subtle g-btn-sm" onClick={()=>change({stops:onSample()})}>Match screenshot colors</button>}
    </ControlDisclosure>
  </>;
}
