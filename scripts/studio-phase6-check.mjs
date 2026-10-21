// Real native export: three different clips, title, still image, audio and transitions.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
await mkdir(root,{recursive:true});
const ffmpeg='glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',ffprobe='glint/src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe';
const run=args=>execFileSync(ffmpeg,['-y','-v','error',...args],{windowsHide:true,maxBuffer:32*1024*1024});
const files=[];
for(const [i,color,size,hz] of [[0,'red','960x540',440],[1,'green','640x960',0],[2,'blue','1920x1080',880]]){
 const path=join(root,`clip-${i}.mp4`);let args=['-f','lavfi','-i',`color=c=${color}:s=${size}:r=30:d=2.5`];if(hz)args.push('-f','lavfi','-i',`sine=frequency=${hz}:sample_rate=48000:duration=2.5`);args.push('-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p');if(hz)args.push('-c:a','aac');args.push(path);run(args);files.push(path);
}
const image=join(root,'still.png');run(['-f','lavfi','-i','color=c=white:s=560x420','-frames:v','1',image]);files.push(image);
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');const before=await Promise.all(files.map(hash));
const main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#'),9242);
try{
 const media=[];for(const path of files)media.push(await main.invoke('scene_media_probe',{path}));
 const project=await main.evaluate(`(async()=>{const m=await import('/src/recorder/sceneModel.ts');const p=m.emptySceneProject();p.width=640;p.height=360;p.look.background={type:'solid',color:'#203040'};p.look.padding=20;p.look.radius=10;p.look.shadow=20;const media=${JSON.stringify(media)};const title=m.newScene();title.title='A local video project';title.duration=1;p.scenes=[title,...media.map(v=>m.newScene(v))];for(const s of p.scenes.filter(s=>s.kind==='video')){s.start=.2;s.end=1.7;}p.scenes[2].transition={kind:'crossfade',duration:.4};p.scenes[3].transition={kind:'slide',duration:.4};p.scenes[4].duration=1;return m.prepareSceneProject(p);})()`);
 const projectPath=join(root,'acceptance.glint-video');await main.invoke('scene_project_save',{path:projectPath,project});const reopened=await main.invoke('scene_project_load',{path:projectPath});assert.deepEqual(reopened,project);
 if(!await main.evaluate("!!document.querySelector('.video-project')"))await main.evaluate("localStorage.removeItem('glint-scene-project-draft-v1')");
 await main.evaluate(`location.hash=${JSON.stringify('#/video-project?path='+encodeURIComponent(projectPath))}`);
 for(let i=0;i<100;i++){if(await main.evaluate(`document.querySelectorAll('.video-project-scenes li').length===5`))break;await pause(100);}
 assert.equal(await main.evaluate(`document.querySelectorAll('.video-project-scenes li').length`),5);await pause(1000);await main.screenshot(join(root,'project-desktop.png'));
 const output=join(root,'acceptance.mp4'),start=Date.now();await main.invoke('scene_project_export',{project,output});
 const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8',windowsHide:true}));
 const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');assert.equal(video.width,640);assert.equal(video.height,360);assert.equal(video.r_frame_rate,'30/1');assert.ok(audio);assert.equal(Number(audio.sample_rate),48000);assert.ok(Math.abs(Number(probe.format.duration)-5.7)<.12,probe.format.duration);
 const frameAt=t=>run(['-ss',String(t),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
 const pixel=(raw,x,y)=>[...raw.subarray((y*640+x)*3,(y*640+x)*3+3)];
 const red=pixel(frameAt(1.4),320,180),blend=pixel(frameAt(2.3),320,180),green=pixel(frameAt(2.8),320,180),blue=pixel(frameAt(4.1),320,180),white=pixel(frameAt(5.2),320,180);
 assert.ok(red[0]>220&&red[1]<30);assert.ok(blend[0]>50&&blend[1]>25&&blend[2]<35,JSON.stringify(blend));assert.ok(green[1]>90&&green[0]<30);assert.ok(blue[2]>220&&blue[0]<30);assert.ok(white.every(c=>c>230));
 const background=pixel(frameAt(1.4),4,4);assert.ok(background.every((c,i)=>Math.abs(c-[32,48,64][i])<5));
 const rms=t=>{const raw=run(['-ss',String(t),'-i',output,'-t','0.1','-map','0:a:0','-ac','1','-f','s16le','pipe:1']);let sum=0;for(let i=0;i<raw.length;i+=2)sum+=raw.readInt16LE(i)**2;return Math.sqrt(sum/(raw.length/2));};
 const audioRms={title:rms(.5),firstClip:rms(1.4),silentClip:rms(2.8),lastClip:rms(4.1)};assert.ok(audioRms.title<20&&audioRms.silentClip<20);assert.ok(audioRms.firstClip>500&&audioRms.lastClip>500);
 const capture=(await main.invoke('captures_list')).find(c=>c.path===output);assert.ok(capture,'Export missing from Library');assert.equal(capture.width,640);assert.equal(capture.height,360);
 const title=frameAt(.5);let bright=0;for(let y=100;y<260;y++)for(let x=80;x<560;x++){const p=pixel(title,x,y);if(p.every(c=>c>210))bright++;}assert.ok(bright>100,'Title text was not rendered');
 // Cancelling must preserve an existing destination, and release the export slot.
 const cancelled=join(root,'cancel-preserves-existing.mp4'),sentinel=Buffer.from('existing destination');await writeFile(cancelled,sentinel);
 const pending=main.invoke('scene_project_export',{project,output:cancelled}).then(value=>({value}),e=>({error:String(e)}));await pause(250);await main.invoke('studio_export_cancel');const result=await pending;assert.ok(result.error?.includes('cancelled'),JSON.stringify(result));assert.deepEqual(await readFile(cancelled),sentinel);
 assert.equal((await readdir(root)).filter(n=>n.startsWith('.glint-scenes-')).length,0,'Export workspace leaked');
 assert.deepEqual(await Promise.all(files.map(hash)),before,'Original media changed');
 const report={passed:true,seconds:((Date.now()-start)/1000),width:video.width,height:video.height,duration:probe.format.duration,red,blend,green,blue,white,background,audioRms,titleBrightPixels:bright,cancellation:result,projectPath,output};await writeFile(join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{main.close();}
