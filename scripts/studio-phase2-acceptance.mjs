import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],fixture=JSON.parse(await readFile(join(root,'fixture.json'),'utf8'));
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
const tesseract=fileURLToPath(new URL('../glint/src-tauri/binaries/tesseract/tesseract.exe',import.meta.url));
const page=await connectPage('/rec-trim');const previous=await page.invoke('recorder_trim_target');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const zoom=(i,start,end,scale=2)=>({id:`zoom-${i}`,start,end,scale,mode:'fixed',focus:{x:.5,y:.43},ease:'gentle',easeIn:.4,easeOut:.4,origin:'manual',edited:true});
const mask=(id,type,rect)=>({id,start:0,end:12,type,strength:28,color:'#161a20',keyframes:[{t:0,...rect}]});
const protectedRect={x:50,y:120,w:530,h:65};
const results=[];
function ocr(path){return execFileSync(tesseract,[path,'stdout','--psm','6','-l','eng'],{windowsHide:true,encoding:'utf8'}).trim();}
async function open(project){
  await pause(450);await writeFile(join(dirname(fixture.source),'project.json'),JSON.stringify(project));
  await page.invoke('recorder_open_trim',{id:-1,path:fixture.source});await pause(500);
  for(let i=0;i<100;i++) {if(await page.evaluate('!!document.querySelector(".studio-panel") && document.querySelector("video")?.readyState>=2'))return;await pause(100);}
  throw new Error('Studio load timed out');
}
try {
  const originalText=ocr(join(root,'source.png'));assert.match(originalText,/DEMO.ONLY.123456/,'The source control must be readable in OCR');
  await open(fixture.project);
  await page.evaluate(`Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Zoom').click()`);
  await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Auto zoom').click()`);await pause(450);
  let data=await page.invoke('studio_load',{path:fixture.source});assert.ok(data.project.zoomSegments.length>=3);
  const autos=data.project.zoomSegments.length;
  await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Add zoom').click()`);await pause(450);
  data=await page.invoke('studio_load',{path:fixture.source});const manual=data.project.zoomSegments.find(s=>s.origin==='manual');assert.ok(manual);
  await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Regenerate').click()`);await pause(450);
  data=await page.invoke('studio_load',{path:fixture.source});assert.deepEqual(data.project.zoomSegments.find(s=>s.id===manual.id),manual);
  await page.screenshot(join(root,'phase2-ui.png'));console.log(`UI auto zoom: ${autos} sensible clusters; manual segment survived regeneration.`);
  const drawingProject=structuredClone(fixture.project);drawingProject.look.enabled=false;
  await open(drawingProject);
  await page.evaluate(`Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Masks & focus').closest('details').open=true`);
  await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Draw mask').click()`);
  const display=await page.evaluate(`(()=>{const r=document.querySelector('.studio-mask-overlay').getBoundingClientRect();const fit=Math.min((r.width-40)/640,(r.height-40)/360);return {x:r.x+20+(r.width-40-640*fit)/2,y:r.y+20+(r.height-40-360*fit)/2,fit};})()`);
  const pointer=(type,x,y)=>page.send('Input.dispatchMouseEvent',{type,x:display.x+x*display.fit,y:display.y+y*display.fit,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
  await pointer('mousePressed',50,120);await pause(30);
  await pointer('mouseMoved',580,185);await pause(30);await pointer('mouseReleased',580,185);await pause(450);
  data=await page.invoke('studio_load',{path:fixture.source});assert.equal(data.project.masks.length,1,'Drawing must create a mask');
  const drawn=data.project.masks[0];assert.equal(drawn.start,0);assert.equal(drawn.end,12);
  for(const key of ['x','y','w','h'])assert.ok(Math.abs(drawn.keyframes[0][key]-protectedRect[key])<2,`Drawing mapped ${key} into the wrong source coordinate`);
  assert.ok(await page.evaluate(`document.body.textContent.includes('Projects keep the unmasked recording') && !!document.querySelector('[aria-label="Delete unmasked source after export"]')`));
  await page.screenshot(join(root,'phase2-mask-ui.png'));console.log('Preview drawing: source rectangle and whole-clip range verified; privacy notice and deletion option present.');
  for(const type of ['blur','pixelate','solid']) {
    const project=structuredClone(fixture.project);project.zoomSegments=[zoom(1,0,3)];project.masks=[{...drawn,type}];
    if(type==='blur')project.motionBlur={enabled:true,intensity:1};
    await open(project);const start=Date.now();const path=await page.invoke('studio_export',{path:fixture.source,project});
    const texts=[];
    for(const t of [0,.15,.5,1,2.8]) {
      const png=join(root,`${type}-${t}.png`);execFileSync(ffmpeg,['-y','-v','error','-ss',String(t),'-i',path,'-frames:v','1',png],{windowsHide:true});
      const text=ocr(png);texts.push({t,text});assert.ok(!/DEMO|123456|APIKEY/.test(text),`${type} leaked the key at ${t}s`);
    }
    const result={type,path,seconds:(Date.now()-start)/1000,ocr:texts};results.push(result);console.log(`${type}: five extracted frames passed OCR, including zoom entrance and motion blur.`);
  }
  const stress=structuredClone(fixture.project);stress.clips[0].end=12;stress.zoomSegments=Array.from({length:22},(_,i)=>({...zoom(i,i*.5,Math.min(12,i*.5+.48),1.5+i%3*.4),easeIn:.15,easeOut:.15}));
  stress.masks=[mask('privacy','blur',protectedRect),mask('lower1','pixelate',{x:40,y:240,w:100,h:60}),mask('lower2','solid',{x:180,y:240,w:100,h:60}),mask('corner','blur',{x:10,y:10,w:25,h:25}),mask('highlight','highlight',{x:30,y:100,w:580,h:110})];
  await open(stress);const stressStart=Date.now();const stressPath=await page.invoke('studio_export',{path:fixture.source,project:stress});
  const probe=await page.invoke('recorder_trim_probe',{path:stressPath});assert.ok(probe.duration_secs>=11.9);assert.equal(probe.has_audio,true);
  results.push({type:'stress',path:stressPath,seconds:(Date.now()-stressStart)/1000,zooms:22,masks:5,probe});console.log('Stress: 22 zooms and five masks exported successfully.');
  await open(stress);data=await page.invoke('studio_load',{path:fixture.source});assert.deepEqual(data.project.zoomSegments,stress.zoomSegments);assert.deepEqual(data.project.masks,stress.masks);
  const legacy=structuredClone(fixture.project);legacy.version=1;delete legacy.zoomSegments;delete legacy.masks;delete legacy.motionBlur;
  await open(legacy);await pause(450);data=await page.invoke('studio_load',{path:fixture.source});assert.equal(data.project.version,2);assert.deepEqual(data.project.look,legacy.look);assert.deepEqual(data.project.clips,legacy.clips);
  const discardFolder=join(root,'Discard check.glint-studio');await mkdir(discardFolder,{recursive:true});
  const discardSource=join(discardFolder,'video.mp4'),discardExport=join(root,'Discard check (Studio).mp4');
  await copyFile(fixture.source,discardSource);await copyFile(join(dirname(fixture.source),'events.json'),join(discardFolder,'events.json'));await writeFile(join(discardFolder,'project.json'),JSON.stringify(stress));
  await assert.rejects(page.invoke('studio_discard_source',{path:discardSource,exportPath:stressPath}),/finished Studio export/);
  assert.ok((await stat(discardSource)).size>1024,'Rejected deletion must retain the source');
  await copyFile(stressPath,discardExport);await page.invoke('studio_discard_source',{path:discardSource,exportPath:discardExport});
  await assert.rejects(stat(discardSource),{code:'ENOENT'});await assert.rejects(stat(join(discardFolder,'events.json')),{code:'ENOENT'});assert.ok((await stat(discardExport)).size>1024);
  results.push({type:'discard',rejectedWrongExport:true,sourceDeleted:true,eventsDeleted:true,exportPreserved:true});
  console.log('Save/reopen, version 1 migration and guarded source deletion passed.');
  await writeFile(join(root,'acceptance.json'),JSON.stringify({originalText,autoZoomCount:autos,drawnMask:drawn,results},null,2));console.log(JSON.stringify({root,checks:'passed'}));
}finally{if(previous)await page.invoke('recorder_open_trim',previous).catch(()=>{});page.close();}
