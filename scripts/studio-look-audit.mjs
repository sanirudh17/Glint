// Real WebView2 crop-input regression and preview/export checks on a temporary project.
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { connectPage } from './studio-cdp.mjs';

const original = JSON.parse(await readFile(join(process.argv[2], 'fixture.json'), 'utf8')).source;
const root = await mkdtemp(join(tmpdir(), 'glint-look-audit-'));
const folder = join(root, 'Look audit.glint-studio'); await mkdir(folder);
const source = join(folder, 'video.mp4'); await copyFile(original, source);
await copyFile(join(dirname(original), 'events.json'), join(folder, 'events.json'));
const baseline = JSON.parse(await readFile(join(dirname(original), 'project.json'), 'utf8'));
baseline.clips = [{id:1,start:0,end:.5,speed:1,kept:true,order:0}];
baseline.crop = null; baseline.fadeIn = 0; baseline.fadeOut = 0;
baseline.look = {...baseline.look,enabled:true,padding:40,radius:50,shadow:0,aspect:'16:9',chrome:{style:'none',theme:'light',buttons:'mac',title:'',url:''},border:{width:0,color:'#ffffff',style:'solid'}};
baseline.cursor = {...baseline.cursor,visible:false,clicks:false,keystrokes:false};
await writeFile(join(folder, 'project.json'), JSON.stringify(baseline));
const page = await connectPage('/rec-trim');
const pause = ms => new Promise(r => setTimeout(r,ms));
async function open(project) {
  await writeFile(join(folder,'project.json'),JSON.stringify(project));
  await page.invoke('recorder_open_trim',{id:-1,path:source});
  await pause(250);
  for(let n=0;n<100;n++) {
    if(await page.evaluate('!!document.querySelector(".studio-panel") && document.querySelector("video")?.readyState >= 2')) {await pause(150); return;}
    await pause(100);
  }
  throw new Error('Studio preview did not load');
}
async function canvas() {
  const meta=await page.evaluate(`(() => {
    const c=document.querySelector('.studio-preview'),r=c.getBoundingClientRect(),s=getComputedStyle(c);
    const px=parseFloat(s.paddingLeft),py=parseFloat(s.paddingTop),innerW=r.width-2*px,innerH=r.height-2*py;
    const scale=Math.min(innerW/c.width,innerH/c.height),width=c.width*scale,height=c.height*scale;
    return {w:c.width,h:c.height,clip:{x:r.x+px+(innerW-width)/2,y:r.y+py+(innerH-height)/2,width,height,scale:1}};
  })()`);
  // Asset-protocol video taints canvas reads, so inspect the real compositor screenshot.
  const capture=await page.send('Page.captureScreenshot',{format:'png',clip:meta.clip});
  const png=Buffer.from(capture.data,'base64');
  const corner=Array.from(execFileSync(ffmpeg,['-v','error','-i','pipe:0','-vf','crop=2:2:4:4','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'],{input:png,windowsHide:true}).subarray(0,3));
  return {...meta,corner,url:`data:image/png;base64,${capture.data}`};
}
const results=[];
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
const cropWidth=`document.querySelector('[aria-label="Crop width"]')`;
try {
  await open(baseline);
  await page.evaluate(`(() => {const d=document.querySelector('.studio-crop'); d.open=true; const input=d.querySelector('[aria-label="Crop width"]');input.scrollIntoView();input.focus();input.select();})()`);
  const before=await canvas();
  for(const digit of ['2','0','0','0']) {
    await page.send('Input.insertText',{text:digit}); await pause(30);
    const value=await page.evaluate(`${cropWidth}.getAttribute('aria-valuenow')`);
    assert.equal(value,'1920','Typing a partial crop must not change the applied width');
    assert.equal((await canvas()).url,before.url,'Typing must not shrink the preview');
  }
  assert.equal(await page.evaluate(`${cropWidth}.value`),'2000');
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}); await pause(100);
  assert.equal(await page.evaluate(`${cropWidth}.value`),'1920');
  assert.equal((await canvas()).url,before.url);
  await page.evaluate(`${cropWidth}.select()`);
  await page.send('Input.insertText',{text:'800'});
  assert.equal(await page.evaluate(`document.querySelector('[aria-label="Increase crop width"]').disabled`),false);
  await page.evaluate(`document.querySelector('[aria-label="Increase crop width"]').click()`);
  assert.equal(await page.evaluate(`${cropWidth}.value`),'801');
  await page.evaluate(`${cropWidth}.focus();${cropWidth}.select()`);
  await page.send('Input.insertText',{text:'800'});
  assert.equal(await page.evaluate(`${cropWidth}.getAttribute('aria-valuenow')`),'801');
  await page.evaluate(`${cropWidth}.blur()`); await pause(100);
  assert.equal(await page.evaluate(`${cropWidth}.getAttribute('aria-valuenow')`),'800');
  await page.screenshot(join(root,'crop-800.png'));
  console.log('Crop: 2000 stays unapplied while typing, clamps to 1920 on Enter; 800 applies on blur.');

  async function choose(label, option) {
    await page.evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
    await page.evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.trim()===${JSON.stringify(option)}).click()`);
  }
  async function input(label, value) {
    await page.evaluate(`(() => {
      const input=document.querySelector('[aria-label=${JSON.stringify(label)}]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
  }
  await choose('Background type','Gradient');
  await page.evaluate('document.querySelectorAll(".look-gradient")[5].click()');
  await pause(400);
  assert.equal((await page.invoke('studio_load',{path:source})).project.look.background.gradientId,JSON.parse(await readFile(new URL('../glint/src/look/gradients.json',import.meta.url),'utf8'))[5].id);
  await choose('Background type','Transparent');
  assert.match(await page.evaluate('document.body.innerText'),/Transparent areas become black in MP4/);
  await choose('Background type','Solid');
  await input('Background color','#abcdef');
  for(const [label,value] of [['padding',75],['radius',25],['shadow',40],['Border width',6],['Shadow color','#ff0044'],['Border color','#123456']]) await input(label,value);
  await choose('Border style','Dashed');
  await choose('Export aspect','4:5');
  await pause(500);
  const changed=(await page.invoke('studio_load',{path:source})).project.look;
  assert.deepEqual(changed.background,{type:'solid',color:'#abcdef'});
  assert.equal(changed.padding,75);assert.equal(changed.radius,25);assert.equal(changed.shadow,40);
  assert.equal(changed.shadowColor,'#ff0044');assert.deepEqual(changed.border,{width:6,color:'#123456',style:'dashed'});
  assert.equal(changed.aspect,'4:5');
  console.log('UI: background modes, gradient selection, all framing sliders, colors, border style and aspect save correctly.');

  const gradients=JSON.parse(await readFile(new URL('../glint/src/look/gradients.json',import.meta.url),'utf8'));
  // A transparent red PNG exercises alpha preservation without any external asset.
  const rgbaPng=await page.evaluate(`(() => {const c=document.createElement('canvas');c.width=2;c.height=2;const ctx=c.getContext('2d');ctx.fillStyle='rgba(200,100,50,${128/255})';ctx.fillRect(0,0,2,2);return c.toDataURL();})()`);
  const imagePath=join(root,'alpha-background.png');await writeFile(imagePath,Buffer.from(rgbaPng.split(',')[1],'base64'));
  await choose('Background type','Image');
  const doc=await page.send('DOM.getDocument');
  const fileInput=await page.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'[aria-label="Background image"]'});
  await page.send('DOM.setFileInputFiles',{nodeId:fileInput.nodeId,files:[imagePath]});await pause(500);
  const uploaded=(await page.invoke('studio_load',{path:source})).project.look.background;
  assert.equal(uploaded.type,'image');assert.ok(uploaded.dataUrl.startsWith('data:image/png;base64,'));
  console.log('UI: image upload loads and persists the chosen background.');
  const cases=[
    {name:'solid',bg:{type:'solid',color:'#a12b7c'},expected:[161,43,124],aspect:'16:9'},
    {name:'gradient',bg:{type:'gradient',gradientId:gradients[0].id},aspect:'1:1'},
    {name:'transparent',bg:{type:'transparent'},expected:[0,0,0],aspect:'9:16'},
    {name:'alpha-image',bg:{type:'image',dataUrl:rgbaPng},expected:[100,50,25],aspect:'4:5'},
  ];
  for(const item of cases) {
    const project=structuredClone(baseline); project.look.background=item.bg; project.look.aspect=item.aspect;
    if(item.name==='gradient') {project.look.shadow=70;project.look.shadowColor='#1122ee';project.look.border={width:6,color:'#ffffff',style:'dashed'};}
    if(item.name==='alpha-image') project.crop={x:101,y:51,w:801,h:601};
    await pause(400); await open(project);
    const preview=await canvas();
    if(item.expected) preview.corner.slice(0,3).forEach((v,i)=>assert.ok(Math.abs(v-item.expected[i])<=1,`${item.name} preview color differs`));
    await writeFile(join(root,`${item.name}-preview.png`),Buffer.from(preview.url.split(',')[1],'base64'));
    const exportStart=performance.now();
    const path=await page.invoke('studio_export',{path:source,project});
    const seconds=(performance.now()-exportStart)/1000;
    const probe=await page.invoke('recorder_trim_probe',{path});
    const [a,b]=item.aspect.split(':').map(Number);
    assert.ok(Math.abs(probe.width/probe.height-a/b)<.003);
    const encodedCorner=Array.from(execFileSync(ffmpeg,['-v','error','-i',path,'-vf','crop=2:2:0:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'],{windowsHide:true}).subarray(0,3));
    if(item.expected) encodedCorner.forEach((v,i)=>assert.ok(Math.abs(v-item.expected[i])<=5,`${item.name} encoded color differs`));
    execFileSync(ffmpeg,['-v','error','-i',path,'-frames:v','1',join(root,`${item.name}-export.png`)],{windowsHide:true});
    results.push({name:item.name,path,seconds,expected:item.expected,preview:{width:preview.w,height:preview.h,corner:preview.corner},export:probe,encodedCorner});
    console.log(`${item.name}: preview ${preview.w}x${preview.h}, export ${probe.width}x${probe.height}, ${seconds.toFixed(2)}s`);
  }
  await writeFile(join(root,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({root,results:results.length}));
} finally {
  await page.invoke('recorder_open_trim',{id:-1,path:original}).catch(()=>{});
  page.close();
}
