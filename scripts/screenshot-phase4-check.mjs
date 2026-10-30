// Real OCR, editor, flattened-output and Library acceptance on synthetic files.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],page=await connectPage('/editor'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const projectPath=join(root,'Privacy.glint'),baseline=JSON.parse(await readFile(projectPath,'utf8')),captures=[],checks=[];
baseline.doc.annotations=[];baseline.doc.crop=null;baseline.doc.canvasSize=null;baseline.doc.frame.enabled=false;
baseline.image.dataBase64=(await readFile(join(root,'source.png'))).toString('base64');baseline.image.width=1600;baseline.image.height=760;
const tess=fileURLToPath(new URL('../glint/src-tauri/binaries/tesseract/tesseract.exe',import.meta.url)),data=fileURLToPath(new URL('../glint/src-tauri/binaries/tesseract/tessdata',import.meta.url));
const ffmpeg=fileURLToPath(new URL('../glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',import.meta.url));
const label=name=>`document.querySelector(${JSON.stringify(`[aria-label="${name}"]`)})`;
const click=text=>page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
async function until(expression){for(let i=0;i<1200;i++){const value=await page.evaluate(expression);if(value)return value;await pause(50);}throw Error('Timed out: '+expression);}
async function open(doc=baseline.doc,image=baseline.image){await writeFile(projectPath,JSON.stringify({...baseline,image,doc}));await page.invoke('project_open',{path:projectPath});await pause(180);await until('!!document.querySelector(".konvajs-content")');}
async function save(){const before=(await stat(projectPath)).mtimeMs;await page.evaluate('document.querySelector(".editor-projectbar").querySelectorAll("button")[1].click()');for(let i=0;i<100;i++){if((await stat(projectPath)).mtimeMs>before){await pause(50);return JSON.parse(await readFile(projectPath,'utf8')).doc;}await pause(40);}throw Error('Save timeout');}
async function exported(name){await until('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Export").disabled');const before=new Set((await page.invoke('captures_list')).map(r=>r.id));await click('Export');let capture;for(let i=0;i<150;i++){capture=(await page.invoke('captures_list')).find(r=>!before.has(r.id));if(capture)break;await pause(40);}assert.ok(capture);captures.push(capture);const png=await readFile(capture.path),path=join(root,name+'.png');await writeFile(path,png);return {capture,png,path};}
const rgba=png=>execFileSync(ffmpeg,['-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-'],{input:png,windowsHide:true,maxBuffer:32*1024*1024});
const ocr=path=>execFileSync(tess,[path,'stdout','-l','eng','--psm','6','--tessdata-dir',data],{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});
async function scan(){await page.evaluate(`${label('Redact (K)')}.click()`);await until('!!document.querySelector(".privacy-panel")');await click('Scan sensitive text');await pause(60);await until('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Scan sensitive text").disabled');const kinds=await page.evaluate('Array.from(document.querySelectorAll(".privacy-suggestions-list li > span")).map(e=>e.textContent)');assert.ok(kinds.length,await page.evaluate('document.querySelector(".privacy-panel [role=status]").textContent'));return kinds;}
try{
  await page.invoke('settings_set',{key:'index_screenshot_text',value:true});
  await page.invoke('settings_set',{key:'auto_name_captures',value:true});
  await open();const original=await exported('before');const originalPixels=rgba(original.png);
  const kinds=await scan();assert.ok(kinds.includes('Email'));assert.ok(kinds.includes('Card number'));
  assert.equal((await save()).annotations.length,0,'Scanning must never auto-apply');
  const suggested=await exported('suggestions-only');assert.ok(rgba(suggested.png).equals(originalPixels),'Suggestion outlines must not enter exported pixels');
  await page.screenshot(join(root,'suggestions-ui.png'));checks.push('Real OCR suggests email/card; scan is opt-in and suggestion outlines never export');
  await page.evaluate(`document.querySelector('[aria-label^="Redact Email"]').click()`);let doc=await save();assert.equal(doc.annotations.length,1);assert.equal(doc.annotations[0].style.redactStyle,'solid');
  await page.evaluate(`${label('Undo')}.click()`);assert.equal((await save()).annotations.length,0);
  await scan();await page.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim().startsWith("Redact all ")).click()');doc=await save();
  assert.ok(doc.annotations.length>=2);assert.ok(doc.annotations.every(a=>a.type==='redact'&&a.style.redactStyle==='solid'));
  const solid=await exported('solid');const text=ocr(solid.path);assert.ok(!text.includes('mail@sample.test'));assert.ok(!text.replace(/\s/g,'').includes('4111111111111111'));
  await page.invoke('project_open',{path:projectPath});await pause(180);assert.deepEqual((await save()).annotations,doc.annotations);checks.push('Accept one/all, undo and editable reopen; exported OCR cannot read accepted email/card');
  const email=doc.annotations.find(a=>a.y<300&&a.y>130);assert.ok(email);
  const image={...baseline.image,dataBase64:solid.png.toString('base64')};
  await open({...baseline.doc,crop:{x:Math.ceil(email.x)+1,y:Math.ceil(email.y)+1,w:Math.floor(email.w)-2,h:Math.floor(email.h)-2}},image);
  const crop=await exported('solid-cropped'),cropPixels=rgba(crop.png);for(let i=0;i<cropPixels.length;i+=4)assert.deepEqual(Array.from(cropPixels.subarray(i,i+4)),[17,17,17,255]);
  checks.push('A later crop of the flattened export contains only opaque replacement pixels');
  for(const mode of ['blur','pixelate']){
    const effect=structuredClone(doc);effect.annotations=effect.annotations.map(a=>({...a,type:mode==='blur'?'blur':'redact',style:{...a.style,redactStyle:'pixelate'}}));
    await open(effect);const out=await exported(mode),text=ocr(out.path);assert.ok(!text.includes('mail@sample.test'),mode+' email');assert.ok(!text.replace(/\s/g,'').includes('4111111111111111'),mode+' card');
  }
  checks.push('Strengthened blur and coarse pixelation make fixture email/card unreadable to OCR');
  // A blur drawn above an accepted solid mask must not resample the original secret.
  const overlap=structuredClone(doc);overlap.annotations.push({...email,id:'overlapping-blur',type:'blur'});await open(overlap);const overlapOut=await exported('overlapping-blur');assert.ok(!ocr(overlapOut.path).includes('mail@sample.test'));
  checks.push('Overlapping privacy effects cannot resample the source beneath a solid mask');
  const db=await page.invoke('plugin:sql|load',{db:'sqlite:glint.db'});
  await page.invoke('library_index_start');for(let i=0;i<1200;i++){const p=await page.invoke('library_index_status');if(!p.running)break;await pause(100);}
  const indexed=await page.invoke('library_search_text',{query:'otterfjordmineral'});assert.ok(indexed.includes(original.capture.id));
  const row=(await page.invoke('captures_list')).find(r=>r.id===original.capture.id);assert.ok(row.title?.includes('Phase four acceptance'));assert.ok(!row.title.includes('otterfjordmineral'));
  await page.invoke('capture_rename',{id:original.capture.id,title:'Manual acceptance name'});await page.invoke('library_index_clear');await page.invoke('library_index_start');for(let i=0;i<1200;i++){if(!(await page.invoke('library_index_status')).running)break;await pause(100);}
  assert.equal((await page.invoke('captures_list')).find(r=>r.id===original.capture.id).title,'Manual acceptance name');
  const main=await connectPage(t=>!t.url.includes('index.html#')&&!t.url.includes('/editor'));
  try{await main.evaluate('location.hash="#/library"');await pause(250);await main.evaluate(`(()=>{const e=document.querySelector('input[type="search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'otterfjordmineral');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);for(let i=0;i<100;i++){if(await main.evaluate('document.body.innerText.includes("Manual acceptance name")'))break;await pause(80);}assert.ok(await main.evaluate('document.body.innerText.includes("Manual acceptance name")'));await main.screenshot(join(root,'library-ui.png'));}finally{main.close();}
  checks.push('FTS5 and Library UI find a pixel-only word; OCR names captures and preserves manual names');
  await page.invoke('settings_set',{key:'index_screenshot_text',value:false});await page.invoke('library_index_clear');assert.deepEqual(await page.invoke('library_search_text',{query:'otterfjordmineral'}),[]);
  const count=await page.invoke('plugin:sql|select',{db,query:'SELECT count(*) AS n FROM capture_text',values:[]});assert.equal(count[0].n,0);
  const ftsCount=await page.invoke('plugin:sql|select',{db,query:'SELECT count(*) AS n FROM capture_text_fts',values:[]});assert.equal(ftsCount[0].n,0);
  await page.invoke('settings_set',{key:'index_screenshot_text',value:true});await page.invoke('settings_set',{key:'auto_name_captures',value:false});
  await open();await scan();await click('Scan sensitive text');await click('Cancel scan');await pause(100);assert.ok(await page.evaluate('document.querySelector(".privacy-panel").innerText.includes("cancelled")'));
  checks.push('Text-index off switch clears stored search text; privacy scan cancellation returns control');
  await writeFile(join(root,'result.json'),JSON.stringify({passed:true,kinds,checks},null,2));console.log(JSON.stringify({passed:true,kinds,checks},null,2));
}finally{await page.invoke('library_index_cancel');for(const c of captures){const rows=await page.invoke('captures_list');if(rows.some(r=>r.id===c.id))await page.invoke('capture_delete',{id:c.id});}page.close();}
