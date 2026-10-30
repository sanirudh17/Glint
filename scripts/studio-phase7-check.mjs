// Native Phase 7 acceptance. Uses owned fixtures and never replaces the open draft.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=join(process.env.LOCALAPPDATA,'GlintValidation','Phase7');await mkdir(root,{recursive:true});
const ffmpeg='glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',ffprobe=ffmpeg.replace('ffmpeg-','ffprobe-');
const ff=args=>execFileSync(ffmpeg,['-y','-v','error',...args],{windowsHide:true,maxBuffer:32*1024*1024});
const probe=path=>JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',path],{windowsHide:true,encoding:'utf8'}));
const page=await connectPage(t=>/^http:\/\/localhost:5173\/(#|$)/.test(t.url),9242);
const state=await page.evaluate(`({draft:localStorage.getItem('glint-scene-project-draft-v1'),url:location.href})`);
const report={};
const video=join(root,'phase7-source.mp4');
try {
 ff(['-f','lavfi','-i','testsrc2=s=640x360:r=30:d=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',video]);
 const before=createHash('sha256').update(await readFile(video)).digest('hex');
 await page.invoke('studio_import',{path:video});
 const eventPath=video+'.glint-studio/events.json';const events=JSON.parse(await readFile(eventPath,'utf8'));events.events=[{kind:'click',t:.5,x:320,y:180,down:true}];await writeFile(eventPath,JSON.stringify(events));
 const {project}=await page.invoke('studio_load',{path:video});
 project.cam=null;
 project.look.enabled=true;project.look.outputSize={width:640,height:360};project.look.background={type:'gradient',gradientId:'dusk',angleDeg:120,animationSeconds:12};project.look.padding=14;
 project.audioCleanup={denoise:true,level:true,clickSounds:false};
 project.clips=[{id:101,start:0,end:1,kept:true,speed:1,order:1},{id:102,start:1,end:3,kept:true,speed:2,order:0}];
 project.captionsEnabled=true;project.captions=[{id:'line',start:1.1,end:2.5,text:'Glint local captions'}];
 const prepared=await page.evaluate(`import('/src/recorder/studioPolish.ts').then(m=>m.prepareCaptions(${JSON.stringify(project)}))`);
 console.log('Exporting timing/audio/caption fixture');
 const exported=await page.invoke('studio_export',{path:video,project:prepared});
 const info=probe(exported);assert.ok(Math.abs(Number(info.format.duration)-2)<.15);assert.equal(info.streams.find(s=>s.codec_type==='audio').sample_rate,probe(video).streams.find(s=>s.codec_type==='audio').sample_rate);
 const frame=(path,t)=>ff(['-ss',String(t),'-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
 const pixel=(raw,x,y)=>[...raw.subarray((y*640+x)*3,(y*640+x)*3+3)];
 const captionFrame=frame(exported,.3);let bright=0;for(let y=305;y<340;y++)for(let x=50;x<590;x++){const p=pixel(captionFrame,x,y);if(p.every(c=>c>220))bright++;}assert.ok(bright>25,`Missing caption pixels: ${bright}`);
 report.timingAudioCaptions={output:exported,duration:info.format.duration,captionBrightPixels:bright};
 console.log('Checking GIF uses the same captions and animated look');
 const gif=await page.invoke('recorder_gif_export',{path:video,project:prepared,segments:[{start:1,end:3,speed:2},{start:0,end:1,speed:1}],fadeIn:0,fadeOut:0,camOverlay:null,options:{fps:10,width:320,repeat:true}});const gifInfo=probe(gif);assert.equal(gifInfo.streams[0].width,320);assert.ok(Math.abs(Number(gifInfo.format.duration)-2)<.15);assert.equal(gifInfo.streams.filter(s=>s.codec_type==='audio').length,0);assert.ok((await readFile(gif)).length<25000000);report.gif={output:gif,duration:gifInfo.format.duration,width:320};

 const media=await page.invoke('scene_media_probe',{path:video});
 const sceneProject=await page.evaluate(`(async()=>{const m=await import('/src/recorder/sceneModel.ts');const p=m.emptySceneProject();p.width=640;p.height=360;p.look={...p.look,padding:16,background:{type:'gradient',gradientId:'dusk',animationSeconds:12}};const title={...m.newScene(),title:'Glint local video',duration:1.2,entrance:'left',shape:'circle'};p.scenes=[title,{...m.newScene(${JSON.stringify(media)}),end:1.5,transition:{kind:'crossfade',duration:.3}}];return m.prepareSceneProject(p);})()`);
 const assembly=join(root,'phase7-motion.mp4');console.log('Exporting animated title and background fixture');await page.invoke('scene_project_export',{project:sceneProject,output:assembly});assert.ok(Math.abs(Number(probe(assembly).format.duration)-2.4)<.12);
 const beginning=frame(assembly,.05),settled=frame(assembly,.8);assert.notDeepEqual(pixel(beginning,320,180),pixel(settled,320,180));report.motion={output:assembly,duration:probe(assembly).format.duration};
 // Camera is its own muted track. Layout must preserve normalized source timing.
 const camera=video.replace(/\.mp4$/,'.cam.webm');ff(['-f','lavfi','-i','color=c=blue:s=320x240:r=30:d=3','-c:v','libvpx','-deadline','realtime','-b:v','400k',camera]);
 const cameraProject={...prepared,look:{...prepared.look,padding:0,radius:0,shadow:0},cam:{x:.7,y:.7,diameter:.2,shape:'rect',visible:true,layout:'side-by-side'}};
 const side=await page.invoke('studio_export',{path:video,project:cameraProject});const sidePixels=frame(side,.3);assert.ok(pixel(sidePixels,550,180)[2]>210);assert.ok(pixel(sidePixels,160,180).some(c=>c>35));
 cameraProject.cam.layout='camera-only';const cameraOnly=await page.invoke('studio_export',{path:video,project:cameraProject});const only=frame(cameraOnly,.3);assert.ok(pixel(only,320,120)[2]>210);report.camera={side,cameraOnly};
 let onlyCaption=0;for(let y=305;y<340;y++)for(let x=50;x<590;x++)if(pixel(only,x,y).every(c=>c>220))onlyCaption++;assert.ok(onlyCaption>25,'Camera-only must retain captions');
 const clickExport=await page.invoke('studio_export',{path:video,project:{...prepared,audioCleanup:{denoise:false,level:false,clickSounds:true}}});
 const tone=t=>{const raw=ff(['-ss',String(t),'-i',clickExport,'-t','0.018','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);let re=0,im=0;const n=raw.length/4;for(let i=0;i<n;i++){const a=2*Math.PI*1600*i/48000,v=raw.readFloatLE(i*4);re+=v*Math.cos(a);im+=v*Math.sin(a);}return 2*Math.hypot(re,im)/n;};const on=tone(1.503),off=tone(1.35);assert.ok(on>.012&&on>off*2,`Click tone timing: ${on}/${off}`);report.clickSounds={output:clickExport,atRetimedClick:on,outsideClick:off};
 assert.equal(createHash('sha256').update(await readFile(video)).digest('hex'),before,'Source recording changed');
 // Download is exercised only when explicitly requested by the test operator.
 if(process.argv.includes('--captions')){
  console.log('Installing optional engine into the isolated validation profile');await page.invoke('studio_captions_install');assert.equal(await page.invoke('studio_captions_status'),true);
  const wav=join(root,'caption-speech.wav');
  execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Speech; $voice=New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice.SetOutputToWaveFile('${wav.replaceAll("'","''")}'); $voice.Speak('Screenshots and videos stay on this device. Glint makes local video editing simple.'); $voice.Dispose()`],{windowsHide:true});
  const speech=join(root,'caption-speech.mp4');ff(['-f','lavfi','-i','color=c=black:s=640x360:r=30','-i',wav,'-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',speech]);
  const duration=Number(probe(speech).format.duration);console.log('Transcribing real local speech');const captions=await page.invoke('studio_captions_generate',{path:speech,duration});assert.ok(captions.length>0);assert.ok(/device|video/i.test(captions.map(c=>c.text).join(' ')));report.speech={duration,captions};
  const cancelled=page.invoke('studio_captions_generate',{path:speech,duration}).then(()=>({completed:true}),error=>({error:String(error)}));await new Promise(r=>setTimeout(r,70));await page.invoke('studio_polish_cancel');const cancellation=await cancelled;assert.match(cancellation.error??'',/cancel/i);report.captionCancellation=true;
 }
 const quiet=join(root,'quiet.mp4');ff(['-f','lavfi','-i','color=c=red:s=160x90:r=15:d=4','-f','lavfi','-i',"aevalsrc=exprs='if(between(t,1,3),0,0.2*sin(2*PI*440*t))':s=8000:d=4",'-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',quiet]);
 const spans=await page.invoke('studio_analyze_silence',{path:quiet});assert.ok(spans.some(s=>s.start>=.9&&s.end<=3.1&&s.end-s.start>1));report.silence=spans;
 await page.invoke('studio_speaker_notes');const notes=await connectPage(t=>t.url.includes('#/rec-notes'),9242);try{for(let i=0;i<30;i++){if(await notes.evaluate(`!!document.querySelector('textarea[aria-label="Speaker notes"]')`))break;await new Promise(r=>setTimeout(r,100));}assert.ok(await notes.evaluate(`!!document.querySelector('textarea[aria-label="Speaker notes"]')`));await notes.evaluate(`setTimeout(()=>import('/node_modules/@tauri-apps/api/window.js').then(m=>m.getCurrentWindow().close()),50)`);}finally{notes.close();}report.notesExclusionVerified=true;
 assert.equal(await page.evaluate(`localStorage.getItem('glint-scene-project-draft-v1')`),state.draft,'The open draft was changed');
 assert.equal((await readdir(root)).filter(n=>n.startsWith('.glint-scenes-')).length,0);
 await writeFile(join(root,'result.json'),JSON.stringify({passed:true,...report},null,2));console.log(JSON.stringify({passed:true,...report}));
}finally{page.close();}
