// Run against an isolated validation app. All projects and exports belong to this fixture.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],page=await connectPage('/editor'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const baseline=JSON.parse(await readFile(join(root,'Legacy.glint'),'utf8')),path=join(root,'Refinements.glint'),checks=[];
const db=await page.invoke('plugin:sql|load',{db:'sqlite:glint.db'});
const capturePaths=[];
const recent=await page.invoke('plugin:sql|select',{db,query:'SELECT value FROM settings WHERE key=$1',values:['recent_projects']});
const label=label=>`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`;
const click=text=>page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
async function until(expression){for(let i=0;i<150;i++){const result=await page.evaluate(expression);if(result)return result;await pause(40);}throw Error('Timed out: '+expression);}
async function open(doc){await writeFile(path,JSON.stringify({...baseline,doc}));await page.invoke('project_open',{path});await pause(150);await until('!!document.querySelector(".konvajs-content")');if(await page.evaluate(`!!${label('Images and canvas')}`))await click('Images');}
async function save(){const before=(await stat(path)).mtimeMs;await page.evaluate('document.querySelector(".editor-projectbar").querySelectorAll("button")[1].click()');for(let i=0;i<100;i++){if((await stat(path)).mtimeMs>before){await pause(50);return JSON.parse(await readFile(path,'utf8')).doc;}await pause(40);}throw Error('Save timeout');}
async function input(name,value){await page.evaluate(`(()=>{const e=${label(name)};e.scrollIntoView({block:'center'});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(50);}
async function number(name,value){await page.evaluate(`(()=>{const e=${label(name)};e.scrollIntoView({block:'center'});e.focus();e.select();})()`);await page.send('Input.insertText',{text:String(value)});await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',windowsVirtualKeyCode:13});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',windowsVirtualKeyCode:13});await pause(60);}
async function pick(x,y){const p=await page.evaluate(`(()=>{const r=document.querySelector('.konvajs-content').getBoundingClientRect();return{x:r.x+${x}*r.width/640,y:r.y+${y}*r.height/360};})()`);for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});await pause(80);}
async function pixel(x,y){await pause(70);return page.evaluate(`(()=>{const e=document.querySelector('.konvajs-content'),c=document.createElement('canvas');c.width=parseFloat(e.style.width);c.height=parseFloat(e.style.height);const ctx=c.getContext('2d');for(const layer of e.querySelectorAll('canvas'))ctx.drawImage(layer,0,0,c.width,c.height);return Array.from(ctx.getImageData(${x},${y},1,1).data).slice(0,3);})()`);}
async function fold(title){await page.evaluate(`Array.from(document.querySelectorAll('summary')).find(s=>s.textContent.trim()===${JSON.stringify(title)}).closest('details').open=true`);}
async function choose(name,text){await page.evaluate(`${label(name)}.click()`);await pause(30);await page.evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);await pause(60);}
async function exported(name,size){
  await until('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Export").disabled');
  const before=new Set((await page.invoke('captures_list')).map(r=>r.id));await click('Export');let capture;
  for(let i=0;i<100;i++){capture=(await page.invoke('captures_list')).find(r=>!before.has(r.id));if(capture)break;await pause(40);}
  assert.ok(capture);capturePaths.push(capture.path);const png=await readFile(capture.path);assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],size);await writeFile(join(root,name+'.png'),png);
}
try {
  await open(baseline.doc);await click('Images');
  assert.equal(await page.evaluate('Array.from(document.querySelectorAll(".editor-frame-slot [aria-pressed=true]")).length'),1);
  await click('Frame');assert.equal((await save()).frame.enabled,true);assert.ok(await page.evaluate(`!!${label('Frame')}`));
  checks.push('Only the visible panel is highlighted; returning to Frame preserves the applied look');

  const image=await page.evaluate(`(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;c.getContext('2d').fillRect(0,0,100,100);return c.toDataURL();})()`);
  const layer={id:'second',type:'image',z:0,style:{color:'#ffffff',strokeWidth:3,fontSize:24},dataUrl:image,name:'Second',x:654,y:0,w:640,h:360};
  const side={...baseline.doc,annotations:[layer],canvasSize:{width:1294,height:360},canvasAutoFit:true};
  await open(side);await click('Images');await click('Second');await page.evaluate(`${label('Delete image layer')}.click()`);
  assert.equal((await save()).canvasSize,null);
  await page.evaluate('document.querySelector("[aria-label=Undo]").click()');assert.deepEqual((await save()).canvasSize,side.canvasSize);
  await click('Second');await page.evaluate(`${label('Delete image layer')}.click()`);await number('Canvas width',1400);await click('Reset canvas size');assert.equal((await save()).canvasSize,null);
  await page.screenshot(join(root,'refined-images.png'));
  checks.push('Side-by-side deletion restores source size; undo and explicit canvas reset work');

  const shape=(id,color)=>({id,type:'rect',z:0,style:{color,fill:color,strokeWidth:2,fontSize:24},x:100,y:100,w:200,h:100});
  await open({...baseline.doc,frame:{...baseline.doc.frame,enabled:false},annotations:[shape('red','#ff0000'),shape('blue','#0000ff')]});
  await pick(180,150);assert.deepEqual(await pixel(180,150),[0,0,255]);
  await page.evaluate(`${label('Send annotation backward')}.click()`);assert.deepEqual(await pixel(180,150),[255,0,0]);
  await page.evaluate(`${label('Bring annotation forward')}.click()`);assert.deepEqual(await pixel(180,150),[0,0,255]);
  const colors=await page.evaluate(`['#ff0000','#0000ff'].map(color=>{const c=document.createElement('canvas');c.width=c.height=100;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,100,100);return c.toDataURL();})`);
  const images=colors.map((dataUrl,i)=>({...layer,id:'image-'+i,name:i?'Blue':'Red',dataUrl,x:100,y:100,w:200,h:100}));
  await open({...baseline.doc,frame:{...baseline.doc.frame,enabled:false},annotations:images});await click('Images');await click('Blue');
  assert.deepEqual(await pixel(180,150),[0,0,255]);await page.evaluate(`${label('Send image backward')}.click()`);assert.deepEqual(await pixel(180,150),[255,0,0]);
  await page.evaluate(`${label('Bring image forward')}.click()`);assert.deepEqual(await pixel(180,150),[0,0,255]);
  checks.push('Image and annotation order change actual overlapping pixels in both directions');

  await open({...baseline.doc,frame:{...baseline.doc.frame,enabled:false}});await pick(250,300);await input('Arrow bend',50);await input('Arrow bend',3);
  let doc=await save();assert.equal(doc.annotations[0].style.curve,0);
  await page.evaluate(`${label('Arrow bend')}.focus()`);await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',windowsVirtualKeyCode:39});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',windowsVirtualKeyCode:39});
  doc=await save();assert.equal(doc.annotations[0].style.curve,.1);assert.equal(doc.annotations[0].x1,100);
  const icon=await page.evaluate(`(()=>{const e=${label('Toggle dashed stroke')}.querySelector('path'),b=e.getBBox();return b.x+b.width/2;})()`);assert.equal(icon,8);
  await page.screenshot(join(root,'refined-arrow.png'));
  checks.push('Arrow center snaps exactly straight, keyboard bend works, dash icon is centered');

  await open(baseline.doc);await fold('Advanced look');
  assert.equal(await page.evaluate(`${label('Export width')}.value`),'768');assert.equal(await page.evaluate(`${label('Export height')}.value`),'488');
  await number('Export width',1234);await number('Export height',777);assert.deepEqual((await save()).frame.outputSize,{width:1234,height:777});
  await exported('refined-custom-size',[1234,777]);
  await click('Reset export size');doc=await save();assert.equal(doc.frame.outputSize,undefined);assert.equal(doc.frame.aspect,'auto');
  await exported('refined-original-size',[768,488]);
  await choose('Export aspect','1:1');await choose('Output size preset','Original resolution');assert.equal((await save()).frame.aspect,'auto');
  await fold('Watermark');await input('Watermark text','Size check');await input('Watermark size',200);assert.equal((await save()).frame.watermark.size,200);
  await page.invoke('project_open',{path});await pause(160);await fold('Watermark');assert.equal(await page.evaluate(`${label('Watermark size')}.value`),'200');
  await exported('refined-watermark-large',[768,488]);
  await input('Watermark size',50);await exported('refined-watermark-small',[768,488]);
  checks.push('Actual export dimensions, custom width/height, original-size reset, watermark size persistence');

  const large=structuredClone(baseline);large.image.width=1920;large.image.height=1080;
  large.image.dataBase64=await page.evaluate(`(()=>{const c=document.createElement('canvas');c.width=1920;c.height=1080;c.getContext('2d').fillRect(0,0,1920,1080);return c.toDataURL().split(',')[1];})()`);
  large.doc.frame={...large.doc.frame,background:{type:'gradient',gradientId:'dusk'}};
  await writeFile(path,JSON.stringify(large));await page.invoke('project_open',{path});await pause(200);
  const latency=await page.evaluate(`(async()=>{const button=document.querySelector('.look-gradient:not(.is-active)');const t=performance.now();button.click();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return performance.now()-t;})()`);
  assert.ok(latency<200,'Gradient update should not wait half a second: '+latency);
  await page.screenshot(join(root,'refined-looks.png'));
  checks.push('1080p gradient click to painted frame: '+latency.toFixed(1)+' ms');
  await page.send('Emulation.setDeviceMetricsOverride',{width:760,height:720,deviceScaleFactor:1,mobile:false});await pause(80);await page.screenshot(join(root,'refined-compact.png'));
  await page.send('Emulation.clearDeviceMetricsOverride');
  await writeFile(join(root,'refinement-result.json'),JSON.stringify({passed:true,checks,latency},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
} finally {
  const rows=await page.invoke('captures_list');for(const path of capturePaths){const row=rows.find(r=>r.path===path);if(row)await page.invoke('capture_delete',{id:row.id});}
  if(recent.length)await page.invoke('plugin:sql|execute',{db,query:'UPDATE settings SET value=$1 WHERE key=$2',values:[recent[0].value,'recent_projects']});else await page.invoke('plugin:sql|execute',{db,query:'DELETE FROM settings WHERE key=$1',values:['recent_projects']});
  page.close();
}
