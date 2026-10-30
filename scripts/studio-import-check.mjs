// Standalone MP4 regression: full Studio UI, persisted edits, safe export, original retained.
import assert from 'node:assert/strict';
import {copyFile,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {connectPage} from './studio-cdp.mjs';
const fixture=JSON.parse(await readFile(join(process.argv[2],'fixture.json'),'utf8'));
const root=await mkdtemp(join(tmpdir(),'glint-import-check-')),source=join(root,'Legacy video.mp4');
await copyFile(fixture.source,source);
const digest=async()=>createHash('sha256').update(await readFile(source)).digest('hex');const before=await digest();
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
const tesseract=fileURLToPath(new URL('../glint/src-tauri/binaries/tesseract/tesseract.exe',import.meta.url));
const page=await connectPage('/rec-trim'),previous=await page.invoke('recorder_trim_target');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function open(){await page.invoke('recorder_open_trim',{id:-1,path:source});await pause(500);for(let i=0;i<100;i++){if(await page.evaluate(`document.querySelector('.studio-project-name')?.textContent==='Legacy video'&&document.querySelector('video')?.readyState>=2`))return;await pause(100);}throw new Error('Imported Studio editor did not appear');}
try {
  await open();let data=await page.invoke('studio_load',{path:source});assert.equal(data.project.importedVideo,true);assert.equal(data.events.events.length,0);
  await assert.rejects(stat(source+'.glint-studio/video.mp4'),{code:'ENOENT'});
  await page.evaluate(`(()=>{const d=Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Zoom').closest('details');d.open=true;d.scrollIntoView({block:'start'});Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Add zoom').click();})()`);
  assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Auto zoom').disabled`),true);
  await page.screenshot(join(root,'import-zoom-ui.png'));
  await page.evaluate(`(()=>{const d=Array.from(document.querySelectorAll('summary')).find(s=>s.textContent==='Masks & focus').closest('details');d.open=true;d.scrollIntoView({block:'start'});Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Draw mask').click();})()`);
  const display=await page.evaluate(`(()=>{const r=document.querySelector('.studio-mask-overlay').getBoundingClientRect();const f=Math.min((r.width-40)/640,(r.height-40)/360);return {x:r.x+20+(r.width-40-640*f)/2,y:r.y+20+(r.height-40-360*f)/2,f};})()`);
  const pointer=(type,x,y)=>page.send('Input.dispatchMouseEvent',{type,x:display.x+x*display.f,y:display.y+y*display.f,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
  await pointer('mousePressed',50,120);await pause(30);await pointer('mouseMoved',580,185);await pause(30);await pointer('mouseReleased',580,185);await pause(450);
  data=await page.invoke('studio_load',{path:source});assert.equal(data.project.zoomSegments.length,1);assert.equal(data.project.masks.length,1);
  for(const [key,value] of Object.entries({x:50,y:120,w:530,h:65}))assert.ok(Math.abs(data.project.masks[0].keyframes[0][key]-value)<2,`Mask ${key} must map to source pixels`);
  assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Delete unmasked source after export"]')`),false);
  await page.screenshot(join(root,'import-mask-ui.png'));
  await open();const reopened=await page.invoke('studio_load',{path:source});assert.deepEqual(reopened.project.zoomSegments,data.project.zoomSegments);assert.deepEqual(reopened.project.masks,data.project.masks);
  const project=structuredClone(data.project);project.clips[0].end=2;
  const exported=await page.invoke('studio_export',{path:source,project});
  const png=join(root,'masked-export.png');execFileSync(ffmpeg,['-y','-v','error','-ss','0.5','-i',exported,'-frames:v','1',png],{windowsHide:true});
  const text=execFileSync(tesseract,[png,'stdout','--psm','6','-l','eng'],{windowsHide:true,encoding:'utf8'});assert.ok(!/APIKEY|DEMO|123456/.test(text));
  await assert.rejects(page.invoke('studio_discard_source',{path:source,exportPath:exported}),/Imported original/);
  assert.equal(await digest(),before,'Studio import, edits, export and rejected deletion must retain the original bytes');
  await writeFile(join(root,'result.json'),JSON.stringify({source,exported,sourceSha256:before,originalUnchanged:true,persistedZooms:1,persistedMasks:1,ocr:text.trim()},null,2));
  console.log(JSON.stringify({root,checks:'passed'}));
}finally{if(previous)await page.invoke('recorder_open_trim',previous).catch(()=>{});page.close();}
