// Verify the fast composition wait never freezes the main window into a capture.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const [root,portText]=process.argv.slice(2),pause=ms=>new Promise(r=>setTimeout(r,ms));
const page=await connectPage(t=>!t.url.includes('index.html#')||t.url.endsWith('index.html'),Number(portText));
const ffmpeg='glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe';
const results=[];let selection=false;
function count(png,color){const raw=execFileSync(ffmpeg,['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{input:png,windowsHide:true,maxBuffer:64*1024*1024});let count=0;for(let i=0;i<raw.length;i+=4)if(raw[i]===color[0]&&raw[i+1]===color[1]&&raw[i+2]===color[2])count++;return count;}
try{
 assert.equal(await page.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),null,'Leave existing captures untouched');
 await mkdir(root,{recursive:true});
 for(let attempt=0;attempt<3;attempt++){
  const color=[251-attempt*2,1+attempt*2,253-attempt*2];
  await page.evaluate(`(()=>{document.getElementById('capture-sentinel')?.remove();const el=document.createElement('div');el.id='capture-sentinel';el.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgb(${color.join(',')})';document.body.append(el);})()`);
  await pause(300);
  const before=Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).data,'base64');
  assert.ok(count(before,color)>100000,'The test window must visibly contain the sentinel');
  await page.invoke('capture_start',{mode:'area'});selection=true;
  let meta;for(let i=0;i<200;i++){meta=await page.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null);if(meta)break;await pause(5);}
  assert.ok(meta,'Capture did not prepare');
  const frozen=await page.invoke('capture_overlay_data',{monitorId:0});
  const png=Buffer.from(frozen.image_data_url.split(',')[1],'base64');
  const sentinelPixels=count(png,color);assert.equal(sentinelPixels,0,'Main window leaked into the frozen desktop');
  await writeFile(join(root,`hidden-window-${attempt}.png`),png);
  await page.invoke('capture_cancel',{monitorId:0});selection=false;results.push({attempt,sentinelPixels});await pause(300);
 }
 await writeFile(join(root,'hidden-window-result.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify(results));
}finally{
 if(selection)await page.invoke('capture_cancel',{monitorId:0}).catch(()=>{});
 await page.evaluate("document.getElementById('capture-sentinel')?.remove()").catch(()=>{});page.close();
}
