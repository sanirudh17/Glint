// Isolated validation identity only. Never run this against the installed app.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage,pages} from './studio-cdp.mjs';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
const main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/'),9242);
const latest=join(process.env.USERPROFILE,'.glint','latest.png');
const mirror=await readFile(latest).catch(()=>null),outputs=[];
const settings=await main.invoke('settings_get_all');
assert.ok(settings.save_dir.includes('GlintValidation'),'Refusing to change a non-validation identity');
const exists=p=>access(p).then(()=>true,()=>false);
async function until(fn,message,limit=15000){const start=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-start>limit)throw Error(message);await pause(50);}}
async function capture(){
 await pause(1000); // Let the previous overlay's paint rendezvous finish.
 const before=(await main.invoke('tray_list')).at(-1)?.id;
 await main.invoke('capture_start',{mode:'area'});
 const meta=await until(()=>main.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),'Selection missing');
 await main.invoke('capture_commit',{rect:{x:100/meta.scale,y:100/meta.scale,w:100/meta.scale,h:160/meta.scale},monitorId:0});
 const item=await until(async()=>{const i=(await main.invoke('tray_list')).at(-1);return i&&i.id!==before&&i;},'Tray missing');
 outputs.push(await readFile(item.path));return item;
}
const result={};
try{
 for(const [key,value] of Object.entries({auto_save:false,auto_copy:false,open_in_editor:false,quick_access_auto_close:false,hide_desktop_icons:false}))await main.invoke('settings_set',{key,value});
 const first=await capture(),attachment=await main.invoke('drag_prepare',{path:first.path}),bytes=await readFile(attachment);
 for(let n=0;n<5;n++)await capture();
 assert.equal(await exists(first.path),false,'Eviction must remove the temporary source');
 assert.deepEqual(await readFile(attachment),bytes);result.evictionAttachmentSurvives=true;
 await pause(8800);assert.ok((await pages(9242)).some(p=>p.url.includes('/hud')),'Default-off HUD must remain');result.autoCloseOff=true;
 await main.invoke('settings_set',{key:'quick_access_auto_close',value:true});
 const hud=await connectPage('/hud',9242);
 await hud.evaluate(`document.querySelector('.tray-root').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`);
 await pause(8700);assert.ok((await pages(9242)).some(p=>p.url.includes('/hud')),'Hover must keep the HUD open');
 await hud.evaluate(`document.querySelector('.tray-root').dispatchEvent(new PointerEvent('pointerout',{bubbles:true}))`);hud.close();
 await until(async()=>!(await pages(9242)).some(p=>p.url.includes('/hud')),'Auto-close did not close idle HUD',12000);
 assert.equal((await main.invoke('tray_list')).length,5);result.autoCloseRetainsCaptures=true;result.hoverPauses=true;
 await main.invoke('editor_open_latest');
 const editor=await until(()=>connectPage('/editor',9242).catch(()=>null),'Latest screenshot editor missing');
 const source=await editor.invoke('editor_source');assert.equal(source.width,100);assert.equal(source.height,160);
 await editor.invoke('plugin:window|close',{label:'editor'});editor.close();result.latestAfterAutoClose=true;
 await main.invoke('settings_set',{key:'quick_access_auto_close',value:false});
 await capture();await until(async()=>(await pages(9242)).some(p=>p.url.includes('/hud')),'New capture must reopen HUD');result.newCaptureReopens=true;
 await main.invoke('tray_clear');assert.deepEqual(await readFile(attachment),bytes);result.clearAttachmentSurvives=true;
 result.attachment=attachment;
 // Keep this preview from competing with the installed app's normal bindings.
 await main.invoke('settings_set',{key:'hotkeys',value:Object.fromEntries(Object.keys(settings.hotkeys).map(k=>[k,'']))});
 await main.invoke('settings_set_hotkey',{action:'open_latest',accelerator:'Ctrl+Alt+Shift+F12'});
 assert.equal((await main.invoke('settings_get_all')).hotkeys.open_latest,'Ctrl+Alt+Shift+F12');
 await main.invoke('settings_set_hotkey',{action:'open_latest',accelerator:''});result.shortcutCanBindAndDisable=true;
 await writeFile(join(root,'clean-result.json'),JSON.stringify({passed:true,...result},null,2));console.log(JSON.stringify(result));
}finally{
 await main.invoke('hotkeys_suspend').catch(()=>{});
 await main.invoke('settings_set',{key:'hotkeys',value:settings.hotkeys}).catch(()=>{});
 for(const key of ['auto_save','auto_copy','open_in_editor','quick_access_auto_close','hide_desktop_icons'])await main.invoke('settings_set',{key,value:settings[key]}).catch(()=>{});
 // Wait for deferred mirror work, then restore only our own output.
 await pause(500);const current=await readFile(latest).catch(()=>null);
 if(mirror&&current&&outputs.some(b=>b.equals(current)))await writeFile(latest,mirror);
 main.close();
}
