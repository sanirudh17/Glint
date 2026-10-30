// Focused pointer, source-layer privacy and large-preview responsiveness checks.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],p=await connectPage('/editor'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const baseline=JSON.parse(await readFile(join(root,'Legacy.glint'),'utf8')),path=join(root,'Pointer.glint');
const db=await p.invoke('plugin:sql|load',{db:'sqlite:glint.db'}),recent=await p.invoke('plugin:sql|select',{db,query:'SELECT value FROM settings WHERE key=$1',values:['recent_projects']});
const exported=[];
const click=text=>p.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
async function save(){const before=(await stat(path)).mtimeMs;await p.evaluate(`document.querySelector('.editor-projectbar').querySelectorAll('button')[1].click()`);for(let i=0;i<100;i++){if((await stat(path)).mtimeMs>before)return JSON.parse(await readFile(path,'utf8')).doc;await pause(50);}throw Error('Save timed out');}
async function mouse(type,x,y,buttons=0){const rect=await p.evaluate(`(()=>{const r=document.querySelector('.konvajs-content').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};})()`);return p.send('Input.dispatchMouseEvent',{type,x:rect.x+x/640*rect.w,y:rect.y+y/360*rect.h,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1});}
try{
  const doc=structuredClone(baseline.doc);doc.frame.enabled=false;doc.annotations=[];await writeFile(path,JSON.stringify({...baseline,doc}));await p.invoke('project_open',{path});await pause(400);
  if(!await p.evaluate(`!!document.querySelector('[aria-label="Images and canvas"]')`))await click('Images');
  await p.evaluate(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#2255ee';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='28px sans-serif';ctx.fillText('SECOND IMAGE',20,90);const blob=await new Promise(r=>c.toBlob(r)),dt=new DataTransfer();dt.items.add(new File([blob],'Drag fixture.png',{type:'image/png'}));const wrap=document.querySelector('.editor-stage-wrap'),r=wrap.getBoundingClientRect();wrap.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,clientX:r.x+80/640*r.width,clientY:r.y+80/360*r.height}));})()`);await pause(250);
  let saved=await save(),image=saved.annotations.find(a=>a.type==='image');assert.ok(Math.abs(image.x-80)<1&&Math.abs(image.y-80)<1,'Dropped coordinates must account for DPI rounding');
  await mouse('mousePressed',200,150,1);await mouse('mouseMoved',220,165,1);await pause(50);await mouse('mouseReleased',220,165);await pause(100);
  saved=await save();image=saved.annotations.find(a=>a.type==='image');assert.ok(Math.abs(image.x-100)<2&&Math.abs(image.y-95)<2,'Dragging must persist source coordinates');
  // Corner transformer resizes the actual source layer, then commits its scale.
  await mouse('mousePressed',image.x+image.w,image.y+image.h,1);await mouse('mouseMoved',image.x+image.w+40,image.y+image.h+25,1);await pause(50);await mouse('mouseReleased',image.x+image.w+40,image.y+image.h+25);await pause(100);
  saved=await save();image=saved.annotations.find(a=>a.type==='image');assert.ok(image.w>320&&image.h>180,'Resizing must persist dimensions');
  await p.evaluate(`document.querySelector('[aria-label="Redact (K)"]').click()`);await mouse('mousePressed',110,160,1);await mouse('mouseMoved',340,220,1);await pause(50);await mouse('mouseReleased',340,220);await pause(100);
  const before=new Set((await p.invoke('captures_list')).map(r=>r.id));await click('Export');let output;for(let i=0;i<100;i++){output=(await p.invoke('captures_list')).find(r=>!before.has(r.id));if(output)break;await pause(50);}assert.ok(output);exported.push(output.path);
  await writeFile(join(root,'source-layer-redaction.png'),await readFile(output.path));
  const rgb=execFileSync('glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',['-v','error','-i',output.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,maxBuffer:4*1024*1024});assert.deepEqual(Array.from(rgb.subarray((180*640+200)*3,(180*640+200)*3+3)),[0,0,0]);assert.deepEqual(Array.from(rgb.subarray((120*640+200)*3,(120*640+200)*3+3)),[34,85,238]);
  const finalDoc=await save();await p.invoke('project_open',{path});await pause(300);assert.deepEqual((await save()).annotations,finalDoc.annotations);
  // Large procedural rendering must leave the main thread responsive.
  const png=await p.evaluate(`(()=>{const c=document.createElement('canvas');c.width=1920;c.height=1080;c.getContext('2d').fillRect(0,0,1920,1080);return c.toDataURL().split(',')[1];})()`);
  const largePath=join(root,'Large.glint'),large={...baseline,image:{...baseline.image,width:1920,height:1080,dataBase64:png},doc:{...doc,frame:{...doc.frame,enabled:true,background:{type:'gradient',gradientId:'spectrum',kind:'mesh',grain:.3}}}};
  await writeFile(largePath,JSON.stringify(large));await p.invoke('project_open',{path:largePath});
  const delays=[];for(let i=0;i<20;i++){const start=performance.now();await p.evaluate('new Promise(r=>setTimeout(r,10))');delays.push(performance.now()-start);}
  assert.ok(Math.max(...delays)<250,'A mesh background must not block interaction');
  for(let i=0;i<150;i++){if(await p.evaluate(`document.querySelector('.editor-canvas')?.getAttribute('aria-busy')==='false'`))break;await pause(50);}
  assert.equal(await p.evaluate(`document.querySelector('.editor-canvas').getAttribute('aria-busy')`),'false');
  await writeFile(join(root,'interaction-result.json'),JSON.stringify({passed:true,drop:true,drag:true,resize:true,privacy:true,maxMainThreadDelayMs:Math.max(...delays)},null,2));console.log(JSON.stringify({passed:true,maxMainThreadDelayMs:Math.max(...delays)}));
}finally{
  for(const file of exported){const row=(await p.invoke('captures_list')).find(r=>r.path===file);if(row)await p.invoke('capture_delete',{id:row.id});}
  if(recent.length)await p.invoke('plugin:sql|execute',{db,query:'UPDATE settings SET value=$1 WHERE key=$2',values:[recent[0].value,'recent_projects']});else await p.invoke('plugin:sql|execute',{db,query:'DELETE FROM settings WHERE key=$1',values:['recent_projects']});p.close();
}
