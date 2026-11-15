// Uses only the isolated PR1 profile and generated media; never edits user recordings.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=join(process.env.LOCALAPPDATA,'GlintValidation','PR1FinalReview');await mkdir(root,{recursive:true});
const ffmpeg=join(process.env.LOCALAPPDATA,'GlintValidation','PR1Implementation','bin','ffmpeg.exe');
const video=join(root,`review-${Date.now()}.mp4`),wait=ms=>new Promise(r=>setTimeout(r,ms));
execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=30:d=8','-f','lavfi','-i',"aevalsrc='if(lt(t,2),0,0.15*sin(2*PI*440*t))':s=48000:d=8",'-c:v','libx264','-preset','ultrafast','-c:a','aac',video],{windowsHide:true});
const main=await connectPage(t=>t.url==='http://127.0.0.1:5181/'||t.url.startsWith('http://127.0.0.1:5181/#'),9231);
let trim;const report={};
const click=async(selector)=>{await trim.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.click()})()`);await wait(100);};
const button=async(text)=>{await trim.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing '+${JSON.stringify(text)});e.click()})()`);await wait(100);};
const rect=selector=>trim.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const mouse=async(type,x,y)=>{await trim.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,clickCount:1});await wait(80);};
const drag=async(b,x,y,dx,dy,held)=>{await mouse('mousePressed',b.x+x*b.w,b.y+y*b.h);await mouse('mouseMoved',b.x+dx*b.w,b.y+dy*b.h);if(held)await held();await mouse('mouseReleased',b.x+dx*b.w,b.y+dy*b.h);};
const selected=()=>trim.evaluate(`(()=>{const e=document.querySelector('.video-annotation-selection');return e?{left:parseFloat(e.style.left),top:parseFloat(e.style.top),width:parseFloat(e.style.width),height:parseFloat(e.style.height)}:null})()`);
try{
 await main.invoke('studio_import',{path:video});
 const eventPath=video+'.glint-studio/events.json',events=JSON.parse(await readFile(eventPath,'utf8'));
 events.events=[{kind:'cursor',t:0,x:50,y:50},{kind:'cursor',t:3,x:300,y:160},{kind:'click',t:3,x:300,y:160,down:true},{kind:'key',t:1,key:'A'}];await writeFile(eventPath,JSON.stringify(events));
 await main.invoke('recorder_open_trim',{id:-1,path:video});trim=await connectPage(t=>t.url.includes('#/rec-trim'),9231);
 for(let i=0;i<80;i++){if(await trim.evaluate(`document.querySelector('.trim-video')?.readyState>=2&&document.querySelector('.studio-project-name')?.textContent===${JSON.stringify(video.split(/[\\/]/).at(-1).replace(/\.mp4$/,''))}`))break;await wait(100);}
 await trim.evaluate(`window.__reviewErrors=[];addEventListener('error',e=>window.__reviewErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__reviewErrors.push(String(e.reason)))`);
 // Real mouse input: persistent drawing, direct picking, single live draft and text resizing.
 await wait(600);await button('Edit & draw');await trim.evaluate(`document.querySelector('.studio-annotations').open=true`);
 await click('[aria-label="Draw rectangle"]');let b=await rect('.video-annotation-overlay');
 await drag(b,.2,.2,.4,.4);await button('Select');await drag(b,.3,.3,.55,.55,async()=>{
   const live=await trim.evaluate(`(()=>{const host=document.querySelector('[data-video-annotation-host]');return {editing:host.dataset.annotationEditing,width:innerWidth}})()`);
   assert.ok(live.editing);const screenshot=join(root,'annotation-drag.png');await trim.screenshot(screenshot);
   const pixel=JSON.parse(execFileSync('python',['-c','from PIL import Image; import sys,json; im=Image.open(sys.argv[1]); scale=im.width/float(sys.argv[4]); print(json.dumps(list(im.getpixel((round(float(sys.argv[2])*scale),round(float(sys.argv[3])*scale))))))',screenshot,String(b.x+b.w*.2),String(b.y+b.h*.3),String(live.width)],{encoding:'utf8',windowsHide:true}));
   assert.ok(pixel[0]<80,'Old red annotation remains in screenshot: '+JSON.stringify(pixel));
 });
 let moved=await selected();assert.ok(Math.abs(moved.left-45)<1,JSON.stringify(moved));await button('Undo mark');assert.ok(Math.abs((await selected()).left-20)<1);await button('Redo');
 for(const tool of ['pen','highlight']){await click(`[aria-label="Draw ${tool}"]`);await drag(b,.1,.65,.25,.7);await drag(b,.35,.65,.5,.7);assert.equal(await trim.evaluate(`document.querySelector('[aria-label="Draw ${tool}"]').getAttribute('aria-pressed')`),'true');}
 await click('[aria-label="Draw text"]');await drag(b,.15,.8,.16,.81);await button('Select');
 await mouse('mousePressed',b.x+b.w*.18,b.y+b.h*.82);await mouse('mouseReleased',b.x+b.w*.18,b.y+b.h*.82);
 const before=await selected();assert.ok(await trim.evaluate(`!!document.querySelector('.video-annotation-resize')`));
 const corner=await rect('.video-annotation-resize');await mouse('mousePressed',corner.x+corner.w/2,corner.y+corner.h/2);await mouse('mouseMoved',corner.x+corner.w/2+70,corner.y+corner.h/2+20);await mouse('mouseReleased',corner.x+corner.w/2+70,corner.y+corner.h/2+20);
 assert.ok((await selected()).height>before.height,'Text resize did not grow');
 report.annotations={directSelectAndMove:true,noOldPositionDuringDrag:true,undoRedo:true,persistentPenAndHighlight:true,textCornerResize:true};await trim.screenshot(join(root,'annotations.png'));
 // Playback must progress repeatedly, including after timing edits and undo/redo.
 await button('Look');const play=async()=>{const start=await trim.evaluate(`document.querySelector('.trim-video').currentTime`);await click('[title="Play/Pause (Space)"]');await wait(400);const end=await trim.evaluate(`document.querySelector('.trim-video').currentTime`);assert.ok(end>start+.15,`${start} -> ${end}`);await click('[title="Play/Pause (Space)"]');};
 await play();await click('[title="Split at playhead (S)"]');await play();await click('[title="Undo (Ctrl+Z)"]');await play();await click('[title="Redo (Ctrl+Shift+Z)"]');await play();
 await click('[title="Play the updated sequence from the start"]');await wait(250);assert.equal(await trim.evaluate(`document.querySelector('.trim-video').paused`),false);await click('[title="Play/Pause (Space)"]');report.playback={repeatedPlay:true,afterSplit:true,afterUndoRedo:true,updatedSequence:true};
 // Crop: corners, handles, apply/cancel. Custom size steps and preview are live.
 await button('Edit & draw');await button('Draw crop on video');b=await rect('.video-crop-image');await drag(b,2/b.w,2/b.h,.75,.75);assert.equal(await trim.evaluate(`document.querySelectorAll('.video-crop-handle').length`),8);await button('Apply crop');assert.equal(await trim.evaluate(`!!document.querySelector('.video-crop-tool')`),false);
 await button('Draw crop on video');await button('Cancel');await button('Look');
 await click('[aria-label="Output size preset"]');await trim.evaluate(`[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Custom size').click()`);await wait(120);
 const size=await trim.evaluate(`Number(document.querySelector('[aria-label="Export width"]').value)`);
 const plus=await trim.evaluate(`(()=>{const input=document.querySelector('[aria-label="Export width"]');return input.parentElement.outerHTML})()`);await click('[aria-label="Increase export width"]');const increased=await trim.evaluate(`Number(document.querySelector('[aria-label="Export width"]').value)`);assert.ok(increased>size);
 await click('[aria-label="Decrease export width"]');assert.ok(await trim.evaluate(`Number(document.querySelector('[aria-label="Export width"]').value)`)<increased);
 await click('[aria-label="Increase export height"]');assert.ok(await trim.evaluate(`Number(document.querySelector('[aria-label="Export height"]').value)`)>0);
 report.sizing={customFields:true,width:size,increaseDecrease:true};
 await button('Auto Balance');await button('Edit & draw');
 await trim.evaluate(`[...document.querySelectorAll('.studio-effects-controls')].forEach(e=>e.open=true)`);await button('Add zoom');assert.ok(await trim.evaluate(`!!document.querySelector('[aria-label="Zoom scale"]')`));
 await click('[aria-label="Show cursor"]');await click('[aria-label="Show cursor"]');
 await button('Draw mask');const maskBox=await rect('.studio-mask-overlay');await drag(maskBox,.3,.3,.5,.5);assert.ok(await trim.evaluate(`!!document.querySelector('[aria-label="Mask type"]')`));report.effects={zoomAdded:true,maskDrawn:true,cursorSwitch:true};
 // Theme-aware native scrollbars, fixed inspector and icon glyphs.
 report.themes=[];for(const theme of ['light','dark']){report.themes.push(await trim.evaluate(`(()=>{document.documentElement.dataset.theme='${theme}';const e=document.querySelector('.studio-panel-controls'),s=getComputedStyle(e);return {theme:'${theme}',width:s.scrollbarWidth,color:s.scrollbarColor,scheme:getComputedStyle(document.documentElement).colorScheme}})()`));}
 assert.ok(report.themes.every(t=>t.width==='thin'&&t.scheme===t.theme));
 await button('Polish');await trim.evaluate(`[...document.querySelectorAll('.studio-polish details')].forEach(e=>e.open=true)`);await button('Find silent stretches');await wait(800);assert.ok(await trim.evaluate(`document.body.innerText.includes('quiet span')`));
 const captions=await main.invoke('studio_captions_status');report.polish={silenceAnalysis:true,captionsEngineInstalled:captions};await button('Open speaker notes');assert.equal(await trim.evaluate(`!!document.querySelector('.studio-polish-progress')`),false);report.polish.notesNoProgressSlider=true;
 await button('Save project');await wait(700);const saved=await main.invoke('studio_load',{path:video});assert.ok(saved.project.annotations.length>=6);assert.ok(saved.project.zoomSegments.length>0&&saved.project.masks.length>0);report.saveProject=true;
 await button('Export MP4');for(let i=0;i<240;i++){if(await trim.evaluate(`document.body.innerText.includes('Exported:')||!!document.querySelector('.studio-export-result')`))break;await wait(250);}
 report.exportStatus=await trim.evaluate(`document.querySelector('.studio-export-error')?.textContent??document.querySelector('.studio-export-result')?.textContent??document.body.innerText.slice(-350)`);
 assert.ok(!await trim.evaluate(`!!document.querySelector('.studio-export-error')`),report.exportStatus);
 const files=(await import('node:fs/promises')).readdir;const outputs=(await files(root)).filter(n=>n.startsWith(video.split(/[\\/]/).at(-1).replace(/\.mp4$/,''))&&n.endsWith('.mp4')&&join(root,n)!==video);
 assert.ok(outputs.length,report.exportStatus);const output=join(root,outputs.at(-1));const exported=await main.invoke('recorder_trim_probe',{path:output});assert.equal(exported.has_audio,true);assert.ok(exported.duration_secs>0);report.export={output,duration:exported.duration_secs,hasAudio:exported.has_audio};
 report.errors=await trim.evaluate(`window.__reviewErrors`);assert.deepEqual(report.errors,[]);
 await writeFile(join(root,'results.json'),JSON.stringify({passed:true,...report},null,2));console.log(JSON.stringify({passed:true,...report}));
}finally{trim?.close();main.close();}
