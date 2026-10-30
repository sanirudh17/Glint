// Real paused-preview regression: a camera can finish decoding after the source.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],folder=join(root,'Camera check.glint-studio');
const fixture=JSON.parse(await readFile(join(root,'fixture.json'),'utf8'));
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
await mkdir(folder,{recursive:true});
await copyFile(fixture.source,join(folder,'video.mp4'));await copyFile(join(root,'Privacy test.glint-studio/events.json'),join(folder,'events.json'));
execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=0x22cc44:s=160x90:r=15','-t','12','-c:v','libvpx','-b:v','300k','-an',join(folder,'video.cam.webm')],{windowsHide:true});
const project=structuredClone(fixture.project);project.look.enabled=false;project.cam={visible:true,x:.75,y:.6,diameter:.18,shape:'square'};
project.masks=[{id:'privacy',start:0,end:12,type:'blur',strength:28,color:'#161a20',keyframes:[{t:0,x:50,y:120,w:530,h:65}]}];
await writeFile(join(folder,'project.json'),JSON.stringify(project));
const page=await connectPage('/rec-trim'),previous=await page.invoke('recorder_trim_target');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function green(path){const raw=execFileSync(ffmpeg,['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,maxBuffer:20*1024*1024});let count=0;for(let i=0;i<raw.length;i+=3)if(raw[i]<70&&raw[i+1]>170&&raw[i+2]<100)count++;return count;}
try {
  await page.invoke('recorder_open_trim',{id:-1,path:join(folder,'video.mp4')});
  for(let i=0;i<100;i++){if(await page.evaluate(`Array.from(document.querySelectorAll('video')).length===2 && Array.from(document.querySelectorAll('video')).every(v=>v.readyState>=2)`))break;await pause(100);}
  assert.equal(await page.evaluate(`document.querySelectorAll('video')[1].readyState>=2`),true,'External camera track must have asset access');
  await page.evaluate(`(()=>{const cv=document.querySelectorAll('video')[1];Object.defineProperty(cv,'readyState',{get:()=>0,configurable:true});document.querySelector('[aria-label="Enable motion blur"]').click();})()`);
  await pause(150);const waiting=join(root,'camera-wait.png');await page.screenshot(waiting);assert.equal(green(waiting),0);
  await page.evaluate(`delete document.querySelectorAll('video')[1].readyState`);
  await pause(150);const ready=join(root,'camera-ready.png');await page.screenshot(ready);assert.ok(green(ready)>500,'Camera must refresh without seeking or playing the source');
  assert.equal(await page.evaluate(`document.querySelector('video').currentTime`),0);
  project.masks.push({id:'camera-private',start:0,end:12,type:'solid',strength:28,color:'#161a20',keyframes:[{t:0,x:480,y:216,w:160,h:144}]});
  const exported=await page.invoke('studio_export',{path:join(folder,'video.mp4'),project});
  const frame=join(root,'camera-masked-export.png');execFileSync(ffmpeg,['-y','-v','error','-i',exported,'-frames:v','1',frame],{windowsHide:true});assert.equal(green(frame),0,'The camera must also be covered by a source mask in export');
  await writeFile(join(root,'camera-check.json'),JSON.stringify({externalTrackLoaded:true,pausedRefresh:true,sourceTime:0,maskedCameraExport:exported},null,2));
  console.log('External camera loaded; late camera frame appeared while paused; camera mask exported correctly.');
}finally{if(previous)await page.invoke('recorder_open_trim',previous).catch(()=>{});page.close();}
