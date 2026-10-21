// Isolated frontend regression: never navigates or changes the user's WebView.
// Native IPC is stubbed here; native playback/export acceptance is separate.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join,extname} from 'node:path';
import {connectPage,pages} from './studio-cdp.mjs';
const root=join(process.env.LOCALAPPDATA,'GlintValidation','Phase6','Layout');
const screenshots=!process.argv.includes('--no-screenshots');
await mkdir(root,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const real=await connectPage(t=>/^http:\/\/localhost:5173\/(#|$)/.test(t.url),9242);
let snapshot,settings;
try {
 snapshot=await real.evaluate(`({draft:localStorage.getItem('glint-scene-project-draft-v1'),url:location.href})`);
 settings=await real.invoke('settings_get_all');
}finally{real.close();}
assert.ok(snapshot.draft,'A preserved draft supplies realistic scene data');
await writeFile(join(root,'user-draft-before.json'),JSON.stringify(snapshot,null,2));
const draft=JSON.parse(snapshot.draft);
const allowed=new Set(draft.project.scenes.map(s=>s.media?.path).filter(Boolean));
const server=createServer(async(req,res)=>{
 try {
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1));
  if(!allowed.has(path)){res.writeHead(404).end();return;}
  const data=await readFile(path);
  res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Type':({'.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'})[extname(path)]??'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const assetPort=server.address().port;
const port=9268;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${join(root,`profile-${Date.now()}`)}`,'--no-first-run','--no-default-browser-check','about:blank'
],{windowsHide:true,stdio:'ignore'});
let page;
const checks=[];
try {
 for(let i=0;i<40;i++){try{if((await pages(port)).length)break;}catch{}await pause(150);}
 page=await connectPage(t=>t.url==='about:blank',port);
 await page.send('Page.enable');
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));
  if(location.hostname==='localhost'){
   const callbacks=new Map();let id=0;
   window.__qa={calls:[],openResult:null,failStorage:false};
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main',windowLabel:'main'}},
    transformCallback:fn=>{callbacks.set(++id,fn);return id;},unregisterCallback:i=>callbacks.delete(i),
    convertFileSrc:p=>'http://127.0.0.1:${assetPort}/'+encodeURIComponent(p),
    invoke:async(cmd,args)=>{window.__qa.calls.push({cmd,args});
     if(cmd==='settings_get_all')return ${JSON.stringify(settings)};
     if(cmd==='captures_list'||cmd==='projects_resolve'||cmd==='library_tags_list')return [];
     if(cmd==='scene_project_load')return ${JSON.stringify(draft.project)};
     if(cmd==='plugin:dialog|open')return window.__qa.openResult;
     if(cmd==='plugin:dialog|save')return null;
     if(cmd==='plugin:dialog|message')return 'Ok';
     if(cmd==='app_version')return '0.1.14';
     if(cmd==='plugin:sql|select')return [];
     if(cmd==='plugin:event|listen')return ++id;
     if(cmd==='plugin:window|is_focused')return true;
     return null;
    }};
   window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
   localStorage.setItem('glint-scene-project-draft-v1',${JSON.stringify(snapshot.draft)});
   localStorage.setItem('glint.nav-expanded','true');
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(window.__qa.failStorage&&k==='glint-scene-project-draft-v1')throw Error('Quota exceeded');return original.call(this,k,v);};
  }
 `});
 await page.send('Emulation.setDeviceMetricsOverride',{width:1400,height:850,deviceScaleFactor:1,mobile:false});
 await page.send('Page.navigate',{url:'http://localhost:5173/#/video-project'});
 for(let i=0;i<40;i++){if(await page.evaluate(`!!document.querySelector('.video-project-scenes li')`))break;await pause(150);}
 const click=async expr=>{await page.evaluate(expr);await pause(100);};
 const panel=async label=>click(`[...document.querySelectorAll('.video-project-inspector-tabs button,.video-project-compact-tabs button')].find(e=>e.getClientRects().length&&e.textContent===${JSON.stringify(label)}).click()`);
 const geometry=()=>page.evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s);return e?.getBoundingClientRect().toJSON();};const content=document.querySelector('.g-content');return {preview:rect('.video-project-preview'),list:rect('.video-project-scenes'),inspector:rect('.video-project-inspector'),body:rect('.video-project-inspector-body'),contentScroll:content.scrollHeight-content.clientHeight,overflow:document.documentElement.scrollWidth-innerWidth,labels:[...document.querySelectorAll('.video-project-inspector .look-label')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent,w:e.clientWidth,scroll:e.scrollWidth,h:e.clientHeight,line:parseFloat(getComputedStyle(e).lineHeight)}))};})()`);
 for(const [theme,width,height] of [['dark',1400,850],['dark',1100,720],['light',850,720],['dark',850,600]]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await page.evaluate(`import('/src/store/useAppStore.ts').then(m=>m.applyTheme(${JSON.stringify(theme)}))`);await pause(200);
  if(width<=850)await panel('Scenes');
  await click(`document.querySelector('.video-project-scenes li:last-child .video-project-scene-select').click()`);
  await panel('Scene settings');
  const g=await geometry();assert.ok(g.contentScroll<=1,JSON.stringify(g));assert.ok(g.overflow<=0);assert.ok(Math.abs(g.preview.width/g.preview.height-draft.project.width/draft.project.height)<.02);
  assert.ok(await page.evaluate(`(()=>{const e=document.querySelector('.video-project-inspector-body');return e.scrollWidth<=e.clientWidth+1;})()`),'Inspector must not hide horizontal overflow');
  assert.ok(g.labels.every(l=>l.scroll<=l.w+1&&l.h<=l.line+2),JSON.stringify(g.labels));
  await click(`(()=>{const e=document.querySelector('button[aria-label="Scene transition"]');e.focus();e.click();})()`);
  const menu=await page.evaluate(`document.querySelector('[role=listbox]').getBoundingClientRect().toJSON()`);
  assert.ok(menu.x>=0&&menu.right<=width&&menu.y>=0&&menu.bottom<=height,JSON.stringify(menu));
  if(screenshots)await page.screenshot(join(root,`scene-${theme}-${width}-${height}.png`));
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await panel('Look & canvas');await pause(100);
  const look=await geometry();assert.ok(look.contentScroll<=1);assert.ok(look.labels.every(l=>l.scroll<=l.w+1&&l.h<=l.line+2));
  if(screenshots)await page.screenshot(join(root,`look-${theme}-${width}-${height}.png`));
  checks.push({theme,width,height,geometry:g,menu});
 }
 // A right-edge portal also clamps when its anchor itself is out of bounds.
 await page.evaluate(`document.querySelector('button[aria-label="Background type"]').style.cssText='position:fixed;right:-24px;bottom:10px;width:120px'`);
 await click(`(()=>{const e=document.querySelector('button[aria-label="Background type"]');e.focus();e.click();})()`);
 const edge=await page.evaluate(`document.querySelector('[role=listbox]').getBoundingClientRect().toJSON()`);
 assert.ok(edge.right<=850&&edge.bottom<=600&&edge.left>=8);checks.push({rightEdge:edge});
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 await click(`document.querySelector('a[aria-label=Home]').click()`);
 assert.ok((await page.evaluate('location.hash')).includes('/home'),'Draft must not block Home');
 const persisted=await page.evaluate(`JSON.parse(localStorage.getItem('glint-scene-project-draft-v1')).project`);
 assert.deepEqual(persisted,draft.project);
 assert.equal(await page.evaluate(`document.querySelector('.home-actions').textContent.includes('Scrolling capture')`),false);
 assert.equal(await page.evaluate(`document.querySelectorAll('.home-project-menu').length`),1);
 await click(`document.querySelector('.home-project-menu summary').click()`);
 if(screenshots)await page.screenshot(join(root,'home-850.png'));
 await click(`document.querySelector('.home-project-options button').click()`);
 assert.equal(await page.evaluate(`document.querySelectorAll('.video-project-scenes li').length`),draft.project.scenes.length);
 await click(`document.querySelector('a[aria-label=Library]').click()`);
 assert.ok((await page.evaluate('location.hash')).includes('/library'),'Draft must not block Library');
 await click(`document.querySelector('a[aria-label=Home]').click()`);
 await click(`window.__qa.openResult='C:/qa/project.glint-video';document.querySelector('.home-project-menu summary').click();document.querySelector('.home-project-options button:last-child').click()`);
 assert.ok((await page.evaluate('location.hash')).includes('path=C%3A%2Fqa%2Fproject.glint-video'));
 await click(`document.querySelector('a[aria-label=Home]').click()`);
 await click(`window.__qa.openResult='C:/qa/picture.glint';document.querySelector('.home-project-menu summary').click();document.querySelector('.home-project-options button:last-child').click()`);
 assert.ok(await page.evaluate(`window.__qa.calls.some(c=>c.cmd==='project_open'&&c.args.path==='C:/qa/picture.glint')`));
 const filters=await page.evaluate(`window.__qa.calls.filter(c=>c.cmd==='plugin:dialog|open').map(c=>c.args.options.filters)`);
 assert.ok(filters.every(f=>f[0].extensions.includes('glint')&&f[0].extensions.includes('glint-video')));
 await click(`document.querySelector('.home-project-menu summary').click();document.querySelector('.home-project-options button').click()`);
 await panel('Scene settings');
 await click(`window.__qa.failStorage=true;document.querySelector('button[aria-label="Increase scene duration"]').click()`);
 assert.ok(await page.evaluate(`document.body.innerText.includes('The draft could not be stored.')`));
 await click(`document.querySelector('a[aria-label=Home]').click()`);
 assert.ok((await page.evaluate('location.hash')).includes('/video-project'),'A failed draft write must protect unsaved edits');
 assert.ok(await page.evaluate(`document.body.innerText.includes('Your draft could not be stored. Save before leaving.')`));
 assert.deepEqual(await page.evaluate('window.__qaErrors'),[]);
 checks.push({homeNavigation:true,libraryNavigation:true,draftRestored:true,combinedProjectPicker:true,storageFailureProtected:true,noRuntimeErrors:true});
 await writeFile(join(root,'result.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,root}));
}catch(error){
  if(page){console.error(await page.evaluate('({text:document.body.innerText,errors:window.__qaErrors,calls:window.__qa?.calls.slice(-10),url:location.href})'));if(screenshots)await page.screenshot(join(root,'failure.png'));}
 throw error;
}finally{
 if(page){await page.send('Browser.close').catch(()=>{});page.close();}
 else chrome.kill();
 await new Promise(r=>server.close(r));
 const verify=await connectPage(t=>/^http:\/\/localhost:5173\/(#|$)/.test(t.url),9242);
 try{assert.deepEqual(await verify.evaluate(`({draft:localStorage.getItem('glint-scene-project-draft-v1'),url:location.href})`),snapshot,'User draft and route must remain untouched');}finally{verify.close();}
}
