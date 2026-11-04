import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
// Optional renderer harness: set GLINT_PLAYWRIGHT_MODULE to playwright-core's index.mjs.
// GLINT_BROWSER_PATH can override the installed Windows Edge executable.
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.GLINT_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.GLINT_PLAYWRIGHT_MODULE).href : 'playwright-core');
const files=['glint/src/styles/tokens.css','glint/src/styles/global.css','glint/src/styles/motion.css','glint/src/hud/hud.css'];
const css=(await Promise.all(files.map(file=>readFile(file,'utf8')))).join('\n').replace(/@import[^;]+;/g,'');
const browser=await chromium.launch({executablePath:process.env.GLINT_BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:244,height:200},reducedMotion:'no-preference'});
 await page.setContent(`<html class="ready"><style>${css}</style><body><div class="tray-root"><div class="tray-stack"><div class="tray-expiry active"><div class="tray-expiry-inner"><div class="tray-expiry-slide"><div class="hud-card">Owned motion fixture</div></div></div></div></div></div></body></html>`);
 await page.waitForTimeout(100);
 const samples=await page.evaluate(async()=>{
  const card=document.querySelector('.tray-expiry'),slide=document.querySelector('.tray-expiry-slide');
  const read=()=>{const style=getComputedStyle(slide);return {x:new DOMMatrix(style.transform).m41,opacity:Number(style.opacity),duration:style.transitionDuration,width:slide.getBoundingClientRect().width};};
  const before=read();card.classList.replace('active','leaving');
  await new Promise(resolve=>setTimeout(resolve,100));const during=read();
  await new Promise(resolve=>setTimeout(resolve,700));const after=read();return {before,during,after};
 });
 await writeFile('work.local/card-motion-samples.json',JSON.stringify(samples,null,2));console.log(samples);
 assert.ok(samples.during.x< -3 && samples.during.x> -samples.during.width,'Card must visibly travel before leaving the viewport');
 assert.ok(samples.during.opacity>=0.95,'Card fades away before its slide can be seen');
 assert.equal(samples.before.duration,'0.7s','Approved exit lasts 700 ms');
 assert.ok(samples.after.x<= -samples.after.width,'Card must slide fully out before removal');
 await page.emulateMedia({reducedMotion:'reduce'});
 const reducedDuration=await page.locator('.tray-expiry-slide').evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration));
 assert.ok(reducedDuration<=0.001,'Reduced motion must disable perceptible travel');
 console.log('Visible slide and reduced motion: PASS');
}finally{await browser.close();}
