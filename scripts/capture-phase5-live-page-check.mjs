// Read-only public-page reproduction in a fresh, unsigned-in browser profile.
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
import assert from 'node:assert/strict';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
const main=await connectPage(t=>/^http:\/\/localhost:5173\/(#|$)/.test(t.url),9242);
if((await main.invoke('capture_scroll_status')).active){main.close();throw Error('An existing capture is active; leave it untouched');}
await mkdir(root,{recursive:true});const profile=await mkdtemp(join(root,'youtube-check-'));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[`--user-data-dir=${profile}`,'--remote-debugging-port=9252','--no-first-run','--no-default-browser-check','--force-device-scale-factor=1','https://www.youtube.com/results?search_query=blender+big+buck+bunny'],{stdio:'ignore'});
let chrome,selection=false,scroll=false;const trace=[];
async function until(fn,message,seconds=30){const start=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-start>seconds*1000)throw Error(message);await pause(200);}}
try{
 chrome=await until(()=>connectPage(t=>t.url.includes('youtube.com'),9252).catch(()=>null),'Browser did not open');
 const {windowId}=await chrome.send('Browser.getWindowForTarget',{targetId:chrome.target.id});await chrome.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'maximized'}});
 const href=await until(()=>chrome.evaluate(`document.querySelector('a[href^="/watch?v="]')?.href`),'No public video result was available',45);
 await chrome.send('Page.navigate',{url:href});
 await until(()=>chrome.evaluate(`!!document.querySelector('video')`),'Video page did not load',45);
 await pause(2500);await chrome.evaluate(`document.querySelectorAll('video').forEach(v=>v.pause());document.title='Glint manual scroll check - public YouTube';window.scrollTo(0,0)`);
 execFileSync('powershell.exe',['-NoProfile','-File','scripts/inspect-owned-window.ps1','-TargetPid',String(browser.pid),'-Pin'],{windowsHide:true});await pause(700);
 for(let attempt=1;attempt<=2;attempt++){
 trace.length=0;
 await chrome.evaluate('window.scrollTo(0,0)');await pause(700);
 await chrome.screenshot(join(root,`youtube-before-${attempt}.png`));
 await main.invoke('capture_scroll_begin');selection=true;
 const meta=await until(()=>main.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),'Selection did not open');
 const workHeight=await chrome.evaluate('Math.round(screen.availHeight*devicePixelRatio)');
 await main.invoke('capture_commit',{rect:{x:0,y:0,w:meta.width/meta.scale,h:workHeight/meta.scale},monitorId:0});selection=false;scroll=true;
 await until(async()=>{const s=await main.invoke('capture_scroll_status');return s.ready;},'Capture did not become ready');
 await main.invoke('capture_scroll_control',{action:'start'});
 const started=Date.now();let advanced=false;
 while(Date.now()-started<45000){
  await chrome.evaluate(`document.querySelectorAll('video').forEach(v=>v.pause())`);
  const state=await main.invoke('capture_scroll_status');
  const page=await chrome.evaluate(`({y:scrollY,comments:!!document.querySelector('#comments'),videoPaused:document.querySelector('video')?.paused})`);
  trace.push({ms:Date.now()-started,...state,...page});
  if(!state.autoScrolling||page.y>=1800){advanced=page.y>=1800;break;}await pause(500);
 }
 await main.invoke('capture_scroll_control',{action:'pause'});await chrome.screenshot(join(root,`youtube-after-${attempt}.png`));
 await writeFile(join(root,`youtube-trace-${attempt}.json`),JSON.stringify({url:href,attempt,advanced,trace},null,2));
 console.log(JSON.stringify({url:href,attempt,advanced,last:trace.at(-1)}));
 assert.ok(advanced,'Paused YouTube capture did not reach the comments');
 assert.ok(trace.at(-1).height>workHeight+1000,'Scrolling did not extend the capture');
 assert.ok(trace.every(s=>s.videoPaused),'The test video must stay paused');
 await main.invoke('capture_scroll_control',{action:'cancel'});
 await until(async()=>!(await main.invoke('capture_scroll_status')).active,'Capture did not cancel');scroll=false;
 }
}finally{
 if(scroll)await main.invoke('capture_scroll_control',{action:'cancel'}).catch(()=>{});
 if(selection)await main.invoke('capture_cancel',{monitorId:0}).catch(()=>{});
 main.close();if(chrome){await chrome.send('Browser.close').catch(()=>{});chrome.close();}else browser.kill();
}
