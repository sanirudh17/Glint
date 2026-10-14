// Verifies the saved cursor layer with two real exports; source bytes are untouched.
import { connectPage } from './studio-cdp.mjs';
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const page=await connectPage('/rec-trim');
const target=await page.invoke('recorder_trim_target');
const fallback=JSON.parse(await readFile(join(process.argv[2],'fixture.json'),'utf8')).source;
let data=target ? await page.invoke('studio_load',{path:target.path}) : null;
const original=data ? target.path : fallback;
data ??= await page.invoke('studio_load',{path:original});
const root=await mkdtemp(join(tmpdir(),'glint-smoothing-check-'));
const folder=join(root,'Smoothing.glint-studio');await mkdir(folder);
const source=join(folder,'video.mp4');await copyFile(original,source);
await copyFile(join(dirname(original),'events.json'),join(folder,'events.json'));
const project=structuredClone(data.project);
project.look={...project.look,enabled:false};project.crop=null;
project.clips=[{id:1,start:0,end:2,speed:1,kept:true,order:0}];
project.cursor={...project.cursor,visible:true,hideIdle:false,clicks:false,keystrokes:false};
await writeFile(join(folder,'project.json'),JSON.stringify(project));
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
try {
  const points=data.events.events.filter(e=>e.kind==='cursor');
  assert.ok(points.length>1,'Studio event sidecar needs a cursor path');
  const sample=points.findIndex((p,i)=>i>0 && Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y)>1);
  assert.ok(sample>0,'The cursor did not move in this source');
  const t=points[sample].t;const probe=await page.invoke('recorder_trim_probe',{path:source});
  const start=Math.max(0,Math.min(probe.duration_secs-2,t-.25));
  project.clips[0]={...project.clips[0],start,end:Math.min(probe.duration_secs,start+2)};
  const paths=[];
  for(const smoothing of [0,1]) {
    project.cursor.smoothing=smoothing;
    paths.push(await page.invoke('studio_export',{path:source,project}));
  }
  const frames=paths.map(path=>execFileSync(ffmpeg,['-v','error','-i',path,'-vf','fps=15,scale=960:-2','-pix_fmt','rgb24','-f','rawvideo','-'],{windowsHide:true,maxBuffer:100*1024*1024}));
  assert.equal(frames[0].length,frames[1].length);
  let changed=0;for(let i=0;i<frames[0].length;i++) if(Math.abs(frames[0][i]-frames[1][i])>12) changed++;
  assert.ok(changed>100,'Smoothing should change rendered cursor positions during motion');
  const result={source:original,cursorSamples:points.length,comparedSeconds:project.clips[0].end-start,changedChannels:changed,paths,shadow:'Intentional downward offset, with soft falloff on every edge.'};
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,root}));
} finally {page.close();}
