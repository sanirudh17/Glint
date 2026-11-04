import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
// Optional renderer harness: set GLINT_PLAYWRIGHT_MODULE to playwright-core's index.mjs.
// GLINT_BROWSER_PATH can override the installed Windows Edge executable.
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.GLINT_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.GLINT_PLAYWRIGHT_MODULE).href : 'playwright-core');
const files=(await readdir('glint/dist/assets')).filter(file=>file.endsWith('.css')).map(file=>`glint/dist/assets/${file}`);
const css=(await Promise.all(files.map(file=>readFile(file,'utf8')))).join('\n').replace(/@import[^;]+;/g,'');
const require=createRequire(new URL('../glint/package.json',import.meta.url));
const {build}=require('esbuild');
const fixture=await build({
 absWorkingDir:path.resolve('glint'),bundle:true,write:false,format:'iife',jsx:'automatic',
 define:{'process.env.NODE_ENV':'"production"'},
 stdin:{loader:'tsx',resolveDir:path.resolve('glint'),contents:`
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {ExpiringTrayCard} from './src/hud/ExpiringTrayCard';
  const root=createRoot(document.querySelector('.tray-stack'));
  root.render(<ExpiringTrayCard item={{id:1,path:'owned.png',width:180,height:90,saved:true,thumb:''}} onChanged={()=>root.unmount()}/>);
 `},
 plugins:[{name:'native-fixture',setup(builder){
  builder.onResolve({filter:/hudIpc$|useAppStore$|\/TrayCard$|^@tauri-apps\/api\/event$/},args=>({path:args.path,namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',resolveDir:path.resolve('glint'),contents:
   args.path.endsWith('hudIpc') ? 'export async function trayDismiss(){window.dismissedAt=performance.now();window.dismissCount=(window.dismissCount||0)+1;}' :
   args.path.endsWith('useAppStore') ? 'export function useAppStore(selector){return selector({settings:{quick_access_auto_close:true}});}' :
   args.path.endsWith('TrayCard') ? `import React from 'react';export function TrayCard(){return React.createElement('div',{className:'hud-card',style:{height:120}},'Owned motion fixture');}` :
   'export async function listen(){return ()=>{};}'
  }));
 }}],
});
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
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.setContent(`<html class="ready"><style>${css}</style><body><div class="tray-root"><div class="tray-stack"></div></div></body></html>`);
 await page.addScriptTag({content:fixture.outputFiles[0].text});
 await page.waitForSelector('.tray-expiry.active');
 const started=await page.evaluate(()=>performance.now());
 await page.waitForFunction(()=>document.querySelector('.tray-expiry.leaving') || window.dismissCount,{timeout:11000,polling:20});
 await page.waitForTimeout(200);
 const lifecycle=await page.evaluate(()=>{
  const slide=document.querySelector('.tray-expiry-slide');
  return {dismissed:window.dismissCount||0,phase:document.querySelector('.tray-expiry')?.className,x:slide ? new DOMMatrix(getComputedStyle(slide).transform).m41 : null};
 });
 assert.equal(lifecycle.dismissed,0,'Production lifecycle must not remove the card before its slide finishes');
 assert.match(lifecycle.phase,/leaving/);
 assert.ok(lifecycle.x< -3,'Real component must visibly slide while still mounted');
 await page.waitForFunction(()=>window.dismissCount,{timeout:2000});
 const result=await page.evaluate(()=>({count:window.dismissCount,at:window.dismissedAt}));
 assert.equal(result.count,1);
 assert.ok(result.at-started>=8950,'Production timer must retain both the 700 ms slide and 350 ms collapse');
 console.log('Real component with minified production CSS: PASS',lifecycle,result);
}finally{await browser.close();}
