import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const page=await connectPage(t=>/^http:\/\/localhost:5173\/(#|$)/.test(t.url),9242),pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await page.evaluate("(()=>{window.__sceneFrameTimes=[];let last=performance.now();const until=last+6500;const tick=t=>{window.__sceneFrameTimes.push(t-last);last=t;if(t<until)requestAnimationFrame(tick);};requestAnimationFrame(tick);})()");
 const r=await page.evaluate("document.querySelector('button[aria-label=\"Play project\"]').getBoundingClientRect().toJSON()");
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});
 await pause(6200);
 const report=await page.evaluate("(()=>{const times=window.__sceneFrameTimes.slice(2).sort((a,b)=>a-b);return {transport:document.querySelector('.video-project-transport').textContent,errors:[...document.querySelectorAll('.video-project-preview-error')].map(e=>e.textContent),frameCount:times.length,p95FrameMs:times[Math.floor(times.length*.95)]};})()");
 assert.ok(report.transport.includes('5.7s / 5.7s'),report.transport);assert.equal(report.errors.length,0);assert.ok(report.frameCount>100);
 await writeFile(join(process.argv[2],'playback-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{page.close();}
