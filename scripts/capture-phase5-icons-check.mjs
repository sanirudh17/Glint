import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
const icons=(value)=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/phase5-desktop-icons.ps1',...(value===undefined?[]:['-Visibility',value?'1':'0'])],{encoding:'utf8',windowsHide:true}).trim());
const main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/'),9242);
const settings=await main.invoke('settings_get_all');assert.ok(settings.save_dir.includes('GlintValidation'));
const original=icons();let selection=false,scroll=false;
try{
 await main.invoke('settings_set',{key:'hide_desktop_icons',value:true});
 for(const initial of [true,false]){
  icons(initial);await main.invoke('capture_scroll_begin');selection=true;
  let meta;for(let i=0;i<100;i++){meta=await main.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null);if(meta)break;await pause(50);}
  assert.ok(meta);assert.equal(icons(),initial,'Frozen selection must restore prior visibility');
  await main.invoke('capture_commit',{rect:{x:100,y:100,w:400,h:300},monitorId:0});selection=false;scroll=true;
  await pause(800);assert.equal(icons(),false,'Icons must stay hidden during scrolling');
  await main.invoke('capture_scroll_control',{action:'cancel'});await pause(600);scroll=false;
  assert.equal(icons(),initial,'Cancel must restore exact prior visibility');
 }
 await main.invoke('settings_set',{key:'hide_desktop_icons',value:false});
 await writeFile(join(root,'icons-result.json'),JSON.stringify({passed:true,visibleRestored:true,initiallyHiddenPreserved:true,optionCanDisable:true},null,2));console.log('Desktop icon restoration passed');
}finally{
 if(scroll){await main.invoke('capture_scroll_control',{action:'cancel'}).catch(()=>{});await pause(600);}
 if(selection)await main.invoke('capture_cancel',{monitorId:0}).catch(()=>{});
 icons(original);await main.invoke('settings_set',{key:'hide_desktop_icons',value:settings.hide_desktop_icons}).catch(()=>{});main.close();
}
