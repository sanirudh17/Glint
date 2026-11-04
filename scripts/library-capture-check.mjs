// Owned local build only. Never selects retention periods that delete user files.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {connectPage} from './studio-cdp.mjs';
const expectedVersion=process.argv[2]??JSON.parse(await readFile(new URL('../glint/package.json',import.meta.url),'utf8')).version;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,message,limit=15000){const start=Date.now();while(Date.now()-start<limit){const value=await fn();if(value)return value;await pause(100);}throw Error(message);}
const main=await connectPage(p=>!/\/(overlay|rec-select|editor|hud)/.test(p.url.split('#')[1]??''));
const original=await main.invoke('settings_get_all');
const clients=[main],result={};
try{
 assert.equal(await main.invoke('app_version'),expectedVersion);
 assert.ok([0,1,7,30].includes(original.screenshot_retention_days));
 await main.evaluate("location.hash='/settings'");
 await until(()=>main.evaluate("!![...document.querySelectorAll('button')].find(b=>b.textContent==='Capture')"),'Settings missing');
 await main.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Capture').click()");
 await until(()=>main.evaluate("!!document.querySelector('button[aria-label=\"Auto-delete saved screenshots\"]')"),'Retention dropdown missing');
 await main.evaluate("document.querySelector('button[aria-label=\"Auto-delete saved screenshots\"]').click()");
 const options=await main.evaluate("[...document.querySelectorAll('.g-select-dropdown [role=option]')].map(e=>e.textContent.trim())");
 assert.deepEqual(options,['Never','After 1 day','After 7 days','After 30 days']);
 await main.evaluate("document.querySelector('button[aria-label=\"Auto-delete saved screenshots\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
 await pause(250);result.retention={options,selectedDays:original.screenshot_retention_days};
 await main.evaluate("location.hash='/library'");
 await until(()=>main.evaluate("!!document.querySelector('.cap-card .cap-kind[aria-label=Screenshot]')"),'Screenshot cards missing');
 assert.equal(await main.evaluate("document.querySelectorAll('.cap-actions').length"),0);
 await main.evaluate("document.querySelector('.cap-card .cap-kind[aria-label=Screenshot]').closest('.cap-card').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:250}))");
 await until(()=>main.evaluate("!!document.querySelector('[role=menu]')"),'Context menu missing');
 const actions=await main.evaluate("[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())");
 for(const action of ['Open in editor','Annotate','Copy image','Pin to screen','Delete'])assert.ok(actions.includes(action));
 await main.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
 await pause(200);result.contextMenu={actions,toolbarRemoved:true};
 for(const [key,value] of Object.entries({auto_save:false,auto_copy:false,open_in_editor:false,quick_access_auto_close:true}))await main.invoke('settings_set',{key,value});
 async function capture(){
  await pause(300);const before=(await main.invoke('tray_list')).at(-1)?.id;
  await main.invoke('capture_start',{mode:'area'});
  await until(()=>main.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),'Capture unavailable');
  await main.invoke('capture_commit',{rect:{x:200,y:200,w:100,h:80},monitorId:0});
  return until(async()=>{const item=(await main.invoke('tray_list')).at(-1);return item&&item.id!==before&&item;},'Capture missing');
 }
 const first=await capture();
 const hud=await until(()=>connectPage('/hud').catch(()=>null),'Quick Access missing');clients.push(hud);
 await until(()=>hud.evaluate("!!document.querySelector('.tray-expiry')"),'Card missing');
 await hud.evaluate(`document.querySelector('[data-capture-id="${first.id}"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`);
 await pause(1000);const second=await capture();
 await pause(8500);
 let items=await main.invoke('tray_list');
 assert.ok(items.some(i=>i.id===first.id),'Hovered card expired');
 assert.ok(!items.some(i=>i.id===second.id),'Unhovered card did not expire independently');
 await hud.evaluate(`document.querySelector('[data-capture-id="${first.id}"]').dispatchEvent(new PointerEvent('pointerout',{bubbles:true}))`);
 await until(async()=>!(await main.invoke('tray_list')).some(i=>i.id===first.id),'Hovered card failed to expire after leaving',12000);
 const third=await capture();items=await main.invoke('tray_list');
 assert.deepEqual(items.map(i=>i.id),[third.id]);
 result.expiry={hoverPaused:true,independent:true,noExpiredCardsReturn:true};
 await main.invoke('tray_dismiss',{id:third.id});
 await writeFile('work.local/library-capture-result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{
 for(const key of ['auto_save','auto_copy','open_in_editor','quick_access_auto_close'])await main.invoke('settings_set',{key,value:original[key]});
 clients.forEach(client=>client.close());
}
