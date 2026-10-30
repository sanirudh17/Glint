// Real bundled-FFmpeg Quick/Studio GIF output, looping, privacy and cancellation.
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms)),source=join(root,'quick-fixture.mp4');
const main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/')),owned=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(await readFile(source));
const ffmpeg='glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',ffprobe='glint/src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe';
const probe=path=>JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8',windowsHide:true}));
const args={path:source,project:null,segments:[{start:0,end:3,speed:1}],fadeIn:0,fadeOut:0,camOverlay:null,options:{fps:10,width:320,repeat:true}};
let editor;
async function remember(path,name){const rows=await main.invoke('captures_list'),row=rows.find(c=>c.path===path);assert.ok(row);assert.equal(row.kind,'gif');owned.push(row.id);await copyFile(path,join(root,name));return readFile(path);}
try{
  await main.invoke('recorder_open_trim',{id:-1,path:source});for(let i=0;i<120;i++){try{editor=await connectPage('/rec-trim');break}catch{await pause(50)}}assert.ok(editor);
  const quick=await main.invoke('recorder_gif_export',args),bytes=await remember(quick,'quick.gif'),q=probe(quick);
  assert.equal(q.streams[0].width,320);assert.equal(q.streams[0].height,180);assert.equal(q.streams[0].r_frame_rate,'10/1');assert.ok(bytes.includes(Buffer.from('NETSCAPE2.0')));assert.ok(bytes.length<25_000_000);
  console.log('Quick GIF dimensions, FPS, looping and size passed.');
  const data=await main.invoke('studio_import',{path:source}),project=data.project;project.look={...project.look,enabled:true,background:{type:'solid',color:'#112233'},padding:20,radius:0,shadow:0,aspect:'1:1'};
  project.masks=[{id:'private',start:0,end:3,type:'solid',strength:24,color:'#000000',keyframes:[{t:0,x:200,y:100,w:160,h:80}]}];
  const studio=await main.invoke('recorder_gif_export',{...args,project,options:{fps:5,width:320,repeat:false}}),studioBytes=await remember(studio,'studio.gif'),s=probe(studio);assert.equal(s.streams[0].width,320);assert.equal(s.streams[0].height,320);assert.ok(!studioBytes.includes(Buffer.from('NETSCAPE2.0')));
  const rgb=execFileSync(ffmpeg,['-v','error','-i',studio,'-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,maxBuffer:12*1024*1024});let frames=0;for(let offset=0;offset<rgb.length;offset+=320*320*3){const i=offset+(142*320+142)*3;assert.deepEqual(Array.from(rgb.subarray(i,i+3)),[0,0,0]);frames++;}assert.ok(frames>=14);
  console.log('Studio GIF square look, solid privacy in every frame and play-once passed.');
  const firstFrame=path=>execFileSync(ffmpeg,['-v','error','-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-'],{windowsHide:true,maxBuffer:2*1024*1024});
  const solid=firstFrame(studio);assert.equal(solid[3],255);for(let i=0;i<3;i++)assert.ok(Math.abs(solid[i]-[17,34,51][i])<8,'Studio solid background must reach GIF');
  const backgrounds=[];
  const stamp=execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=0x2864c8:s=16x16','-frames:v','1','-f','image2pipe','-vcodec','png','-'],{windowsHide:true});
  for(const background of [{type:'gradient',kind:'linear',angleDeg:0,grain:0,stops:[{offset:0,color:'#ff0000'},{offset:1,color:'#0000ff'}]},{type:'image',dataUrl:`data:image/png;base64,${stamp.toString('base64')}`}]){
    const path=await main.invoke('recorder_gif_export',{...args,project:{...project,look:{...project.look,background}},options:{fps:5,width:320,repeat:false}});
    await remember(path,`${background.type}.gif`);const pixels=firstFrame(path);assert.equal(pixels[3],255);
    if(background.type==='gradient'){assert.ok(pixels[0]>pixels[2]+100);const end=(319*4);assert.ok(pixels[end+2]>pixels[end]+100);}
    else for(let i=0;i<3;i++)assert.ok(Math.abs(pixels[i]-[40,100,200][i])<8,'Studio image background must reach GIF');
    backgrounds.push(background.type);
  }
  console.log('Studio solid, gradient and image backgrounds match the selected look.');
  const transparentProject={...project,look:{...project.look,background:{type:'transparent'}}};
  const transparent=await main.invoke('recorder_gif_export',{...args,project:transparentProject,options:{fps:5,width:320,repeat:true}}),transparentBytes=await remember(transparent,'transparent.gif');
  const rgba=execFileSync(ffmpeg,['-v','error','-i',transparent,'-f','rawvideo','-pix_fmt','rgba','-'],{windowsHide:true,maxBuffer:16*1024*1024});
  for(let offset=0;offset<rgba.length;offset+=320*320*4){
    assert.equal(rgba[offset+3],0,'surroundings must be transparent');
    const i=offset+(142*320+142)*4;assert.deepEqual(Array.from(rgba.subarray(i,i+4)),[0,0,0,255],'black privacy must stay opaque');
  }
  assert.ok(transparentBytes.length<25_000_000);
  assert.equal(await editor.evaluate(`!!document.querySelector('.trim-progress')`),false,'native progress must not activate an idle UI export');
  console.log('Transparent surroundings and opaque black privacy in every frame passed.');
  const pending=main.invoke('recorder_gif_export',{...args,project}).then(path=>({path}),error=>({error:String(error)}));await pause(120);await main.invoke('studio_export_cancel');const cancelled=await pending;assert.ok(cancelled.error?.toLowerCase().includes('cancel'),JSON.stringify(cancelled));assert.ok(!(await readdir(join(root,'output'))).some(n=>n.endsWith('partial.gif')));
  assert.equal(hash(await readFile(source)),before);await editor.screenshot(join(root,'gif-controls-ui.png'));
  await writeFile(join(root,'gif-result.json'),JSON.stringify({passed:true,quick:{width:320,height:180,fps:10,loop:true,bytes:bytes.length},studio:{width:320,height:320,fps:5,loop:false,frames,bytes:studioBytes.length,opaqueMaskAllFrames:true,backgrounds:['solid',...backgrounds,'transparent'],transparentSurroundingsOpaqueMask:true},cancelled:true,sourceUnchanged:true},null,2));console.log('Cancellation cleanup and unchanged source passed.');
}finally{for(const id of owned)await main.invoke('capture_delete',{id});editor?.close();main.close();}
