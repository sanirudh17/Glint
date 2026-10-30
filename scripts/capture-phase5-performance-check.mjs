// Comparable optimized executables, each with its own seeded database/profile.
// Launch them sequentially; this script never edits captures or the clipboard.
import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';

const [root,label,portText,pidText]=process.argv.slice(2);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const port=Number(portText),pid=Number(pidText);
assert.ok(root&&label&&port>0&&pid>0,'Pass artifact directory, build label, CDP port and owned process PID');
const page=await connectPage(t=>!t.url.includes('index.html#')||t.url.endsWith('index.html'),port);
async function until(fn,message){const start=Date.now();for(;;){const result=await fn();if(result)return result;if(Date.now()-start>15000)throw Error(message);await pause(10);}}
function memory(){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/phase5-memory.ps1','-RootPid',String(pid)],{encoding:'utf8',windowsHide:true}));}
let selection=false;
try{
 assert.equal(await page.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label"),'main');
 assert.equal(await page.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),null,'An existing capture must remain untouched');
 await page.evaluate("location.hash='#/library'");
 await until(()=>page.evaluate("document.querySelectorAll('img').length>0&&[...document.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)"),'Library thumbnails did not finish loading');
 await pause(10000);
 const idle=[];for(let i=0;i<5;i++){idle.push(memory());await pause(1000);}
 const captures=[];
 for(let trial=0;trial<11;trial++){
  const started=performance.now();await page.invoke('capture_start',{mode:'area'});selection=true;
  await until(()=>page.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),'Capture metadata did not become available');
  const metadataMs=Math.round(performance.now()-started);
  await until(()=>page.invoke('plugin:window|is_visible',{label:'overlay-0'}),'Selection overlay did not show');
  const visibleMs=Math.round(performance.now()-started);
  await page.invoke('capture_cancel',{monitorId:0});selection=false;
  captures.push({trial,metadataMs,visibleMs});await pause(600);
 }
 await pause(3000);const afterCapture=memory();
 const result={label,port,pid,captures,idle,afterCapture,library:await page.evaluate("({images:document.querySelectorAll('img').length,width:innerWidth,height:innerHeight})"),userAgent:await page.evaluate('navigator.userAgent')};
 await mkdir(root,{recursive:true});await writeFile(join(root,`${label}-performance.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{
 if(selection)await page.invoke('capture_cancel',{monitorId:0}).catch(()=>{});
 page.close();
}
