import {useState} from 'react';
import {NumberInput,Select,Switch} from '../components/ui';
export interface GifOptions {fps:number;width:number;repeat:boolean}
export function GifExportControls({disabled,duration,onExport}:{disabled:boolean;duration:number;onExport:(options:GifOptions)=>void}){
  const [options,setOptions]=useState<GifOptions>({fps:15,width:960,repeat:true});
  return <details className="trim-gif">
    <summary>GIF export</summary>
    <div className="trim-gif-content">
      <label>FPS <Select ariaLabel="GIF frames per second" value={String(options.fps)} options={[5,10,15,20,25,30].map(n=>({value:String(n),label:String(n)}))} disabled={disabled} onChange={value=>setOptions(s=>({...s,fps:Number(value)}))}/></label>
      <label>Maximum width <NumberInput ariaLabel="GIF maximum width" value={options.width} min={320} max={1920} step={1} unit="px" disabled={disabled} onChange={width=>setOptions(s=>({...s,width}))}/></label>
      <Switch label="Loop" checked={options.repeat} disabled={disabled} onChange={repeat=>setOptions(s=>({...s,repeat}))}/>
      <button className="trim-btn" disabled={disabled||duration>60||duration<=0} onClick={()=>onExport(options)}>Export GIF</button>
      <span className="look-hint">{duration>60?'Trim to 60 seconds or less to export a GIF.':'Up to 60 seconds and 25 MB. GIFs have no audio.'}</span>
    </div>
  </details>;
}
