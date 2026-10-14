import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const fixture=JSON.parse(await readFile(join(process.argv[2],'fixture.json'),'utf8'));
const root=await mkdtemp(join(tmpdir(),'glint-focus-check-')),folder=join(root,'Focus check.glint-studio');await mkdir(folder);
const source=join(folder,'video.mp4');await copyFile(fixture.source,source);await copyFile(join(dirname(fixture.source),'events.json'),join(folder,'events.json'));
const page=await connectPage('/rec-trim'),previous=await page.invoke('recorder_trim_target'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
const readouts=()=>page.evaluate(`['Zoom horizontal focus','Zoom vertical focus'].map(label=>Number(document.querySelector('[aria-label="'+label+'"]').value))`);
let exported=[];
try {
  for(const mode of ['fixed','follow-cursor']) {
    const project=structuredClone(fixture.project);project.look.enabled=false;project.zoomSegments=[{id:'focus',start:0,end:3,scale:2,mode,focus:{x:.5,y:.5},ease:'gentle',easeIn:.4,easeOut:.4,origin:'manual',edited:true}];
    await pause(450);await writeFile(join(folder,'project.json'),JSON.stringify(project));await page.invoke('recorder_open_trim',{id:-1,path:source});await pause(600);
    await page.evaluate(`(()=>{document.querySelector('[aria-label="Zoom 1"] .studio-effect-name').click();const d=Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Zoom').closest('details');d.open=true;d.scrollIntoView({block:'start'});})()`);
    const display=await page.evaluate(`(()=>{const c=document.querySelector('.studio-preview'),r=c.getBoundingClientRect(),f=Math.min((r.width-40)/640,(r.height-40)/360);return {x:r.x+20+(r.width-40-640*f)/2,y:r.y+20+(r.height-40-360*f)/2,f};})()`);
    const mouse=(type,x,y)=>page.send('Input.dispatchMouseEvent',{type,x:display.x+x*640*display.f,y:display.y+y*360*display.f,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1});
    const pick=()=>page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Pick focus in preview').click()`);
    await pick();await pause(50);await mouse('mouseMoved',.3,.4);await pause(100);let values=await readouts();assert.ok(Math.abs(values[0]-30)<=1&&Math.abs(values[1]-40)<=1,`Both readouts must update while aiming: ${values}`);
    await pause(450);let data=await page.invoke('studio_load',{path:source});assert.deepEqual(data.project.zoomSegments[0].focus,{x:.5,y:.5},'Hover must not save');
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await page.evaluate(`!!document.querySelector('.studio-preview.is-picking')`),false);assert.ok(await page.evaluate(`!!document.querySelector('.studio-panel')`),'Escape must cancel aiming without closing the editor');
    await pick();await mouse('mouseMoved',.65,.55);await pause(100);await page.screenshot(join(root,mode+'-aim.png'));
    await mouse('mousePressed',.65,.55);await mouse('mouseReleased',.65,.55);await pause(450);data=await page.invoke('studio_load',{path:source});
    const segment=data.project.zoomSegments[0];assert.ok(Math.abs(segment.focus.x-.65)<.01&&Math.abs(segment.focus.y-.55)<.01);assert.equal(segment.mode,mode);
    if(mode==='follow-cursor'){assert.ok(Math.abs(segment.followOffset.x-.15)<.01);assert.ok(Math.abs(segment.followOffset.y-(.55-260/360))<.01);}
    const scrub=async t=>{const r=await page.evaluate(`(()=>{const r=document.querySelector('.trim-track').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,x:r.x+r.w*t/12,y:r.y+r.h/2,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});await pause(200);};
    await scrub(.5);const a=await readouts();await scrub(1.5);const b=await readouts();
    if(mode==='fixed')assert.deepEqual(a,b,'Fixed focus must stay locked');else assert.ok(Math.abs(a[0]-b[0])>1&&Math.abs(a[1]-b[1])>1,'Both follow readouts must track playback');
    await page.invoke('recorder_open_trim',{id:-1,path:source});await pause(600);assert.deepEqual((await page.invoke('studio_load',{path:source})).project.zoomSegments[0],segment);
    if(mode==='follow-cursor') {
      for(const offset of [segment.followOffset,{x:0,y:0}]) {const test=structuredClone(data.project);test.clips[0].end=1;test.zoomSegments[0].followOffset=offset;exported.push(await page.invoke('studio_export',{path:source,project:test}));}
      const frames=exported.map(path=>execFileSync(ffmpeg,['-v','error','-ss','0.2','-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,maxBuffer:4*1024*1024}));
      let changed=0;for(let i=0;i<frames[0].length;i++)if(Math.abs(frames[0][i]-frames[1][i])>10)changed++;assert.ok(changed>1000,'The picked follow framing must also affect native export');
    }
    console.log(mode+': live aiming, click, Escape, playback and persistence passed.');
  }
  await writeFile(join(root,'result.json'),JSON.stringify({hoverIsUnsaved:true,bothModes:true,escapeCancels:true,exported},null,2));console.log(JSON.stringify({root,checks:'passed'}));
}finally{if(previous)await page.invoke('recorder_open_trim',previous).catch(()=>{});page.close();}
