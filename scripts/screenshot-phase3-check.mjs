// Real production WebView2 acceptance. Uses only owned temporary projects.
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],page=await connectPage('/editor'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const baseline=JSON.parse(await readFile(join(root,'Legacy.glint'),'utf8')),testPath=join(root,'Acceptance.glint');
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
const captures=[];let results=[];
const db=await page.invoke('plugin:sql|load',{db:'sqlite:glint.db'});
const recent=await page.invoke('plugin:sql|select',{db,query:'SELECT value FROM settings WHERE key=$1',values:['recent_projects']});
async function waitFor(expression){for(let i=0;i<100;i++){const result=await page.evaluate(expression);if(result)return result;await pause(50);}throw new Error('Timed out: '+expression);}
async function open(doc){await writeFile(testPath,JSON.stringify({...baseline,doc}));await page.invoke('project_open',{path:testPath});await pause(300);await waitFor('!!document.querySelector(".konvajs-content")');await waitFor(`document.querySelector('.editor-canvas').getAttribute('aria-busy')!=='true'`);if(await page.evaluate(`!!document.querySelector('[aria-label="Images and canvas"]')`)){await clickText('Images');await pause(60);}}
const clickText=text=>page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
async function save(){const before=(await stat(testPath)).mtimeMs;await page.evaluate(`document.querySelector('.editor-projectbar').querySelectorAll('button')[1].click()`);for(let i=0;i<100;i++){if((await stat(testPath)).mtimeMs>before){await pause(80);return JSON.parse(await readFile(testPath,'utf8')).doc;}await pause(50);}throw new Error('Project save did not finish');}
async function choose(label,value){await page.evaluate(`(()=>{const b=document.querySelector('[aria-label=${JSON.stringify(label)}]');b.scrollIntoView({block:'center'});b.click();})()`);await pause(50);await page.evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(b=>b.textContent.trim().startsWith(${JSON.stringify(value)})).click()`);await pause(70);}
async function input(label,value){await page.evaluate(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.scrollIntoView({block:'center'});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(60);}
async function number(label,value){await page.evaluate(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.scrollIntoView({block:'center'});e.focus();e.select();})()`);await page.send('Input.insertText',{text:String(value)});await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',windowsVirtualKeyCode:13});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',windowsVirtualKeyCode:13});await pause(100);}
async function fold(title){await page.evaluate(`(()=>{const e=Array.from(document.querySelectorAll('summary')).find(s=>s.textContent.trim()===${JSON.stringify(title)}).closest('details');e.open=true;e.scrollIntoView({block:'start'});})()`);await pause(50);}
async function preview(){return page.evaluate(`(()=>{const e=document.querySelector('.konvajs-content'),c=document.createElement('canvas');c.width=parseFloat(e.style.width);c.height=parseFloat(e.style.height);const ctx=c.getContext('2d');for(const layer of e.querySelectorAll('canvas'))ctx.drawImage(layer,0,0,c.width,c.height);return {w:c.width,h:c.height,png:c.toDataURL().split(',')[1]};})()`);}
function pixels(png){return execFileSync(ffmpeg,['-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-'],{input:Buffer.from(png,'base64'),windowsHide:true,maxBuffer:40*1024*1024});}
function comparePixels(a,b,label){const first=pixels(a),second=pixels(b);assert.equal(first.length,second.length);let large=0;for(let i=0;i<first.length;i++)if(Math.abs(first[i]-second[i])>30)large++;assert.ok(large/first.length<.02,label+': differences exceed DPI antialiasing tolerance: '+large/first.length);}
async function exported(name,expectedSize){await waitFor(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Export').disabled`);const before=new Set((await page.invoke('captures_list')).map(r=>r.id));await clickText('Export');let item;for(let i=0;i<100;i++){item=(await page.invoke('captures_list')).find(r=>!before.has(r.id));if(item)break;await pause(50);}assert.ok(item,'Native export did not create a capture');captures.push(item.path);const png=await readFile(item.path);await writeFile(join(root,name+'.png'),png);const size=[png.readUInt32BE(16),png.readUInt32BE(20)];if(expectedSize)assert.deepEqual(size,expectedSize);return {size,png:png.toString('base64')};}

try{
  await open(baseline.doc);const oldPreview=await preview(),oldExport=await exported('legacy-before',[768,488]);
  comparePixels(oldPreview.png,oldExport.png,'Old document preview/native export');
  const oldDoc=await save();assert.deepEqual(oldDoc.annotations,baseline.doc.annotations);assert.deepEqual(oldDoc.frame,baseline.doc.frame);
  await page.invoke('project_open',{path:testPath});await pause(350);assert.ok(pixels((await preview()).png).equals(pixels(oldPreview.png)),'Old document appearance must survive reopen');
  results.push('legacy appearance, annotations and reopening');console.log(results[results.length-1]+' passed');
  await fold('Customize gradient');await choose('Gradient color count','Three colors');await input('Gradient color 1','#000000');await input('Gradient color 2','#ff0000');await input('Gradient color 3','#ffffff');await input('Gradient angle',0);await input('Gradient grain',30);
  for(const kind of ['Linear','Radial','Conic','Mesh']){
    await choose('Gradient style',kind);const doc=await save();assert.equal(doc.frame.background.kind,kind.toLowerCase());assert.equal(doc.frame.background.stops.length,3);assert.equal(doc.frame.background.grain,.3);
    const p=await preview(),out=await exported(kind.toLowerCase());comparePixels(p.png,out.png,kind+' preview/export');
  }
  results.push('all gradient geometries, colors, angle and grain');console.log(results[results.length-1]+' passed');
  const presets=JSON.parse(await readFile(new URL('../glint/src/look/gradients.json',import.meta.url),'utf8'));
  for(const category of ['vivid','soft','dark','pastel','neutral']){
    await choose('Gradient collection',category[0].toUpperCase()+category.slice(1));
    for(const g of presets.filter(g=>g.category===category)){await page.evaluate(`document.querySelector('[aria-label=${JSON.stringify(g.label)}]').click()`);assert.equal((await save()).frame.background.gradientId,g.id);}
  }
  assert.equal(presets.length,48);results.push('48 preset buttons in all five collections');console.log(results[results.length-1]+' passed');
  await clickText('Auto Balance');const balanced=await save();assert.equal(balanced.frame.aspect,'auto');assert.equal(balanced.frame.outputSize,undefined);assert.equal(balanced.frame.padding,23);
  const beforeSize=await preview();assert.deepEqual([beforeSize.w,beforeSize.h],[714,434]);
  for(const [aspect,size] of [['3:2',[714,476]],['1.91:1',[829,434]]]){await choose('Export aspect',aspect);await exported('aspect-'+aspect.replace(':','-'),size);}
  await choose('Output size preset','OG image · 1200 × 630');await exported('og-size',[1200,630]);
  await fold('Watermark');await input('Watermark text','Glint phase 3');await input('Watermark color','#ffffff');await input('Watermark opacity',70);await choose('Watermark position','Bottom left');
  await fold('Advanced look');await input('Border width',6);await input('Border color','#00ff00');await choose('Border style','Dashed');
  const decorated=await save();assert.equal(decorated.frame.watermark.text,'Glint phase 3');assert.equal(decorated.frame.border.style,'dashed');await exported('watermark-border',[1200,630]);await page.screenshot(join(root,'looks-ui.png'));
  await choose('Output size preset','App Store · 1290 × 2796');await exported('app-store-size',[1290,2796]);
  for(const [label,size] of [['Square post',[1080,1080]],['Portrait post',[1080,1350]],['Story',[1080,1920]],['Landscape',[1920,1080]]]){await choose('Output size preset',label);await exported('size-'+size.join('x'),size);}await choose('Output size preset','App Store');
  results.push('Auto Balance, exact social sizes, watermark and border');
  await clickText('Images');
  await page.evaluate(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#2255ee';ctx.fillRect(0,0,320,180);ctx.fillStyle='#ffffff';ctx.font='32px sans-serif';ctx.fillText('SECOND IMAGE',20,90);const blob=await new Promise(r=>c.toBlob(r));const dt=new DataTransfer();dt.items.add(new File([blob],'Second.png',{type:'image/png'}));const e=document.querySelector('[aria-label="Add image layer"]');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(200);
  let doc=await save();assert.equal(doc.annotations.filter(a=>a.type==='image').length,1);await clickText('Place side by side');doc=await save();assert.deepEqual(doc.canvasSize,{width:1294,height:360});
  const layer=doc.annotations.find(a=>a.type==='image');assert.equal(layer.x,654);assert.equal(layer.h,360);
  await number('Image x',640);await number('Image w',620);doc=await save();assert.equal(doc.annotations.find(a=>a.type==='image').x,640);assert.equal(doc.annotations.find(a=>a.type==='image').w,620);
  await number('Canvas width',1400);doc=await save();assert.equal(doc.canvasSize.width,1400);
  await page.invoke('project_open',{path:testPath});await pause(350);assert.deepEqual((await save()).annotations,doc.annotations);await page.screenshot(join(root,'images-ui.png'));await exported('combined-images',[1290,2796]);
  // Native OS-drop ingress verifies decoding without changing the original file.
  const nativeLayer=await page.invoke('editor_read_layer',{path:join(root,'source.png')});assert.equal(nativeLayer.width,640);assert.ok(nativeLayer.dataUrl.startsWith('data:image/png;base64,'));
  results.push('image import, positions, resize, side-by-side, expanded canvas and reopen');
  // Exercise arrow bend and text presets with real selected nodes and save UI.
  const annoDoc=structuredClone(baseline.doc);annoDoc.frame.enabled=false;annoDoc.annotations.push({id:'t',type:'text',z:0,style:{color:'#ffffff',strokeWidth:3,fontSize:24},x:50,y:240,text:'Text preset'});
  await open(annoDoc);if(await page.evaluate(`!!document.querySelector('[aria-label="Images and canvas"]')`))await clickText('Images');
  await page.evaluate(`document.querySelector('[aria-label="Select (V)"]').click()`);
  const point=await page.evaluate(`(()=>{const r=document.querySelector('.konvajs-content').getBoundingClientRect();return{x:r.x+250*r.width/640,y:r.y+300*r.height/360};})()`);
  for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});await pause(100);
  await input('Arrow bend',50);doc=await save();assert.equal(doc.annotations.find(a=>a.id==='old-arrow').style.curve,.5);await exported('curved-arrow',[640,360]);await page.screenshot(join(root,'arrow-ui.png'));
  const textPoint=await page.evaluate(`(()=>{const r=document.querySelector('.konvajs-content').getBoundingClientRect();return{x:r.x+85*r.width/640,y:r.y+252*r.height/360};})()`);for(const type of ['mousePressed','mouseReleased'])await page.send('Input.dispatchMouseEvent',{type,...textPoint,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});await pause(100);
  for(const preset of ['Heading','Label','Code','Plain']){await choose('Text style',preset);doc=await save();assert.equal(doc.annotations.find(a=>a.id==='t').style.textPreset,preset.toLowerCase());await exported('text-'+preset.toLowerCase(),[640,360]);}
  await page.evaluate(`document.querySelector('[aria-label="Send annotation backward"]').click()`);doc=await save();assert.equal(doc.annotations[0].id,'t');await page.invoke('project_open',{path:testPath});await pause(300);assert.equal((await save()).annotations[0].id,'t');
  results.push('curved arrow, four text styles, annotation ordering and persistence');
  // A shared screenshot look is accepted by the native video compositor too.
  const fixtureRoot=process.argv[3]??JSON.parse(await readFile(join(root,'fixture.json'),'utf8')).videoFixtureRoot;
  assert.ok(fixtureRoot,'Pass the synthetic video fixture root as the third argument.');
  const fixture=JSON.parse(await readFile(join(fixtureRoot,'fixture.json'),'utf8')),videoFolder=join(root,'Video.glint-studio');await mkdir(videoFolder,{recursive:true});await copyFile(fixture.source,join(videoFolder,'video.mp4'));await copyFile(join(dirname(fixture.source),'events.json'),join(videoFolder,'events.json'));
  const project=structuredClone(fixture.project);project.look=decorated.frame;project.clips[0].end=.4;project.zoomSegments=[];project.masks=[];await writeFile(join(videoFolder,'project.json'),JSON.stringify(project));
  const video=await page.invoke('studio_export',{path:join(videoFolder,'video.mp4'),project});captures.push(video);const frame=join(root,'shared-look-video.png');execFileSync(ffmpeg,['-y','-v','error','-i',video,'-frames:v','1',frame],{windowsHide:true});const bytes=await readFile(frame);assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[1200,630]);results.push('shared look native video export');
  await writeFile(join(root,'result.json'),JSON.stringify({passed:true,results,captures},null,2));console.log(JSON.stringify({root,passed:true,results}));
}finally{
  // Delete only captures whose exact paths were returned by this test's own exports.
  const rows=await page.invoke('captures_list');for(const path of captures){const row=rows.find(r=>r.path===path);if(row)await page.invoke('capture_delete',{id:row.id});}
  if(recent.length)await page.invoke('plugin:sql|execute',{db,query:'UPDATE settings SET value=$1 WHERE key=$2',values:[recent[0].value,'recent_projects']});else await page.invoke('plugin:sql|execute',{db,query:'DELETE FROM settings WHERE key=$1',values:['recent_projects']});
  page.close();
}
