// Real React/WebView layouts in an isolated Chrome profile. IPC is stubbed;
// studio-phase7-check.mjs supplies the separate native export/inference checks.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {connectPage,pages} from './studio-cdp.mjs';
const root=join(process.env.LOCALAPPDATA,'GlintValidation','Phase7','UI');await mkdir(root,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const native=await connectPage(t=>/^http:\/\/localhost:5173\/(#|$)/.test(t.url),9242);
const path=join(process.env.LOCALAPPDATA,'GlintValidation','Phase7','phase7-source.mp4');
let data,settings,probe;
try{data=await native.invoke('studio_load',{path});settings=await native.invoke('settings_get_all');probe=await native.invoke('recorder_trim_probe',{path});}finally{native.close();}
data.project.clips=[{id:1,start:0,end:3,speed:1,kept:true,order:0}];data.project.cam={x:.72,y:.72,diameter:.2,shape:'circle',visible:true,layout:'overlay'};data.project.captions=[];data.project.captionsEnabled=false;Object.assign(data.project.look,{padding:16,radius:12,shadow:20});
const camera=path.replace(/\.mp4$/,'.cam.webm'),allowed=new Set([path,camera]);
const server=createServer(async(req,res)=>{try{if(req.url==='/snapshot'){res.writeHead(200,{'Content-Type':'text/html'});res.end(await readFile(join(root,'studio-snapshot.html')));return;}const file=decodeURIComponent(req.url.slice(1));if(!allowed.has(file)){res.writeHead(404).end();return;}const bytes=await readFile(file);res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Type':extname(file)==='.webm'?'video/webm':'video/mp4'});res.end(bytes);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const assetPort=server.address().port,port=9271;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${join(root,'profile-'+Date.now())}`,'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
let page;
try{
 for(let i=0;i<40;i++){try{if((await pages(port)).length)break;}catch{}await pause(100);}
 page=await connectPage(t=>t.url==='about:blank',port);await page.send('Page.enable');
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));
 window.__qaCalls=[];const callbacks=new Map();let id=0;
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'rec-trim'},currentWebview:{label:'rec-trim',windowLabel:'rec-trim'}},transformCallback:fn=>{callbacks.set(++id,fn);return id;},unregisterCallback:i=>callbacks.delete(i),convertFileSrc:p=>'http://127.0.0.1:${assetPort}/'+encodeURIComponent(p),invoke:async(cmd,args)=>{window.__qaCalls.push({cmd,args});
 if(cmd==='settings_get_all')return ${JSON.stringify(settings)};
 if(cmd==='recorder_trim_target')return {id:1,path:${JSON.stringify(path)}};
 if(cmd==='recorder_trim_probe')return ${JSON.stringify(probe)};
 if(cmd==='recorder_trim_waveform')return [];
 if(cmd==='studio_load')return ${JSON.stringify(data)};
 if(cmd==='studio_captions_status')return false;
 if(cmd==='studio_captions_generate')return [{id:'example',start:.3,end:1.4,text:'Screenshots stay on this device.'}];
 if(cmd==='plugin:event|listen')return ++id;
 if(cmd==='plugin:dialog|message')return 'Ok';
 return null;}};window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 `});
 await page.send('Emulation.setDeviceMetricsOverride',{width:1400,height:850,deviceScaleFactor:1,mobile:false});await page.send('Page.navigate',{url:'http://localhost:5173/#/rec-trim'});
 for(let i=0;i<60;i++){if(await page.evaluate(`!!document.querySelector('.studio-panel-tabs')`))break;await pause(100);}
 const click=async expression=>{await page.evaluate(expression);await pause(100);};
 const tab=async text=>click(`[...document.querySelectorAll('.studio-panel-tabs button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
 await tab('Polish');await click(`[...document.querySelectorAll('summary')].find(e=>e.textContent==='Local captions').parentElement.open=true`);
 assert.equal(await page.evaluate(`window.__qaCalls.some(c=>c.cmd==='studio_captions_install')`),false,'No automatic model download');
 assert.ok(await page.evaluate(`document.body.innerText.includes('77.8 MiB')`));
 await click(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Download caption engine').click()`);
 assert.ok(await page.evaluate(`window.__qaCalls.some(c=>c.cmd==='studio_captions_install')`));
 await click(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Generate captions').click()`);
 assert.equal(await page.evaluate(`document.querySelector('textarea[aria-label="Caption example text"]').value`),'Screenshots stay on this device.');
 // Removing a transcript span edits the same cut model; undo restores it.
 await click(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Remove line & video span').click()`);
 assert.equal(await page.evaluate(`document.querySelectorAll('.studio-caption-line').length`),0);
 await click(`document.querySelector('button[title="Undo (Ctrl+Z)"]').click()`);
 assert.equal(await page.evaluate(`document.querySelectorAll('.studio-caption-line').length`),1);
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'k',code:'KeyK',modifiers:2});await pause(100);
 assert.equal(await page.evaluate(`document.querySelector('.studio-command-dialog').open`),true);
 assert.ok(await page.evaluate(`document.querySelector('.studio-command-dialog').textContent.includes('Split clip at playhead')`));
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 assert.equal(await page.evaluate(`document.querySelector('.studio-command-dialog').open`),false,'Escape must close the command palette');
 const views=[];
 for(const [theme,width,height] of [['dark',1400,850],['dark',1100,720],['light',850,720]]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await page.evaluate(`import('/src/store/useAppStore.ts').then(m=>m.applyTheme(${JSON.stringify(theme)}))`);await pause(200);
  for(const name of ['Look','Edit','Polish']){
   await tab(name);await pause(100);
   const g=await page.evaluate(`(()=>{const panel=document.querySelector('.studio-panel'),root=document.querySelector('.trim-root');return {overflow:document.documentElement.scrollWidth-innerWidth,panelOverflow:panel.scrollWidth-panel.clientWidth,rootOverflow:root.scrollHeight-root.clientHeight,preview:document.querySelector('.studio-stage').getBoundingClientRect().toJSON(),labels:[...panel.querySelectorAll('.look-label')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth}))};})()`);
   assert.ok(g.overflow<=1&&g.panelOverflow<=1,JSON.stringify(g));assert.ok(g.preview.width>200&&g.preview.height>100,JSON.stringify(g));assert.ok(g.labels.every(l=>l.scroll<=l.width+1),JSON.stringify(g.labels));
   await page.screenshot(join(root,`${name.toLowerCase()}-${theme}-${width}.png`));views.push({theme,width,height,name,...g});
  }
 }
 assert.deepEqual(await page.evaluate('window.__qaErrors'),[]);
 // A script-free snapshot lets Taste inspect the actual DOM/styles without
 // needing Tauri IPC in its newly launched browser. Preview is a real capture.
 await tab('Polish');await page.send('Emulation.setDeviceMetricsOverride',{width:1400,height:850,deviceScaleFactor:1,mobile:false});await page.evaluate(`import('/src/store/useAppStore.ts').then(m=>m.applyTheme('dark'))`);await pause(200);
 const rect=await page.evaluate(`document.querySelector('.studio-preview').getBoundingClientRect().toJSON()`);
 const png=(await page.send('Page.captureScreenshot',{format:'png',clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:1}})).data;
 const html=await page.evaluate(`(()=>{const doc=document.documentElement.cloneNode(true);doc.querySelectorAll('script').forEach(e=>e.remove());doc.querySelector('body').style.background=getComputedStyle(document.querySelector('.trim-root')).backgroundColor;const base=document.createElement('base');base.href='http://localhost:5173/';doc.querySelector('head').prepend(base);const canvas=doc.querySelector('.studio-preview');const img=document.createElement('img');img.className=canvas.className;img.src='data:image/png;base64,${png}';canvas.replaceWith(img);return '<!doctype html>'+doc.outerHTML;})()`);
 await writeFile(join(root,'studio-snapshot.html'),html);
 // Scene history and commands use the same explicit action names.
 await page.evaluate(`import('/src/recorder/sceneModel.ts').then(m=>{localStorage.setItem('glint-scene-project-draft-v1',JSON.stringify({project:m.emptySceneProject(),path:'',dirty:false}));location.hash='/video-project';})`);
 for(let i=0;i<40;i++){if(await page.evaluate(`!!document.querySelector('.video-project')`))break;await pause(100);}
 await click(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Title card').click()`);
 assert.ok(await page.evaluate(`!!document.querySelector('button[title="Undo: Add title card"]')`));
 await click(`document.querySelector('button[title="Undo: Add title card"]').click()`);
 assert.equal(await page.evaluate(`document.querySelectorAll('.video-project-scenes > li').length`),0);
 await click(`document.querySelector('button[title="Redo: Add title card"]').click()`);
 assert.equal(await page.evaluate(`document.querySelectorAll('.video-project-scenes > li').length`),1);
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'k',code:'KeyK',modifiers:2});await pause(100);
 assert.ok(await page.evaluate(`document.querySelector('.studio-command-dialog').textContent.includes('Undo: Add title card')`));
 assert.deepEqual(await page.evaluate('window.__qaErrors'),[]);
await writeFile(join(root,'result.json'),JSON.stringify({passed:true,noAutomaticDownload:true,captionDeleteUndo:true,sceneNamedUndo:true,commands:true,views},null,2));
 console.log(JSON.stringify({passed:true,views:views.length,root,snapshot:join(root,'studio-snapshot.html')}));
}catch(e){if(page)console.error(await page.evaluate(`({text:document.body.innerText,errors:window.__qaErrors})`));throw e;}
finally{if(page){await page.send('Browser.close').catch(()=>{});page.close();}else chrome.kill();await new Promise(r=>server.close(r));}
