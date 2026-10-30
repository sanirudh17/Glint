import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
const page=await connectPage(t=>/^http:\/\/localhost:5173\/(#|$)/.test(t.url),9242);
const results=[];
try{
 await pause(500);
 assert.equal(await page.evaluate("document.querySelectorAll('.video-project-scenes li').length"),5);
 const title=await page.evaluate("document.querySelector('.video-project-scene-select strong').textContent");
 await page.evaluate("document.querySelector('button[aria-label=\"Move scene 1 later\"]').click()");await pause(100);
 assert.notEqual(await page.evaluate("document.querySelector('.video-project-scene-select strong').textContent"),title);
 await page.evaluate("document.querySelector('button[aria-label=\"Undo scene edit\"]').click()");await pause(300);
 assert.equal(await page.evaluate("document.querySelector('.video-project-scene-select strong').textContent"),title);
 // Native range setter plus input events exercise React's actual seek handler.
 const seek=async t=>{await page.evaluate(`(()=>{const el=document.querySelector('input[aria-label="Project playhead"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${t});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(500);};
 await seek(2.3);
 assert.ok((await page.evaluate("document.querySelector('.video-project-transport').textContent")).includes('2.3s'));
 const center=async()=>{const r=await page.evaluate("document.querySelector('.video-project-preview').getBoundingClientRect().toJSON()");const png=Buffer.from((await page.send('Page.captureScreenshot',{format:'png',clip:{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})).data,'base64');const raw=execFileSync('glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',['-v','error','-i','pipe:0','-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:png,windowsHide:true,maxBuffer:4*1024*1024});return [...raw.subarray((90*320+160)*3,(90*320+160)*3+3)];};
 const canvases=await page.evaluate("[...document.querySelectorAll('.video-project-preview canvas')].map(c=>({w:c.width,h:c.height}))");const blend=await center();
 assert.equal(canvases.length,2);assert.ok(blend[0]>50&&blend[1]>25&&blend[2]<35,JSON.stringify(blend));results.push({transition:'crossfade',canvases,blend});
 await seek(3.4);assert.equal(await page.evaluate("document.querySelectorAll('.video-project-scene-layer').length"),2);
 const slide=await page.evaluate("[...document.querySelectorAll('.video-project-scene-layer')].map(e=>e.style.transform)");assert.ok(slide[0].includes('-'));results.push({transition:'slide',transforms:slide});
 await seek(0);await pause(300);
 const titlePreview=await page.evaluate("(()=>{const c=document.querySelector('.video-project-preview canvas');return {w:c.width,h:c.height};})()");assert.ok(titlePreview.w>300);const titlePixel=await center();assert.ok(titlePixel.some(c=>c>30));results.push({titlePreview,titlePixel});
 for(const [theme,width,height] of [['dark',1100,720],['light',850,720]]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await page.evaluate(`import('/src/store/useAppStore.ts').then(m=>m.applyTheme(${JSON.stringify(theme)}))`);await pause(500);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Horizontal overflow');await page.screenshot(join(root,`project-${theme}-${width}.png`));
 }
 await writeFile(join(root,'ui-result.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify(results));
}finally{
 await page.send('Emulation.clearDeviceMetricsOverride').catch(()=>{});await page.evaluate("import('/src/store/useAppStore.ts').then(m=>m.applyTheme('dark'))").catch(()=>{});page.close();
}
