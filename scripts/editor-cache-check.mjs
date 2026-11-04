import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const expectedVersion=process.argv[2]??JSON.parse(await readFile(new URL('../glint/package.json',import.meta.url),'utf8')).version;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message){for(let attempt=0;attempt<150;attempt++){const result=await check();if(result)return result;await pause(100);}throw Error(message);}
const main=await connectPage(p=>!/\/(overlay|rec-select|editor|hud)/.test(p.url.split('#')[1]??''));
const original=await main.invoke('settings_get_all');
const dir=join(process.env.LOCALAPPDATA,'com.glint.app','tmp');
try{
 assert.equal(await main.invoke('app_version'),expectedVersion);
 const before=new Set(await readdir(dir));
 const tray=(await main.invoke('tray_list')).map(item=>item.id);
 for(const [key,value] of Object.entries({auto_save:false,auto_copy:false,open_in_editor:true}))await main.invoke('settings_set',{key,value});
 for(let index=0;index<3;index++){
  await main.invoke('capture_start',{mode:'area'});
  await until(()=>main.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),'Overlay unavailable');
  const width=101+index;
  await main.invoke('capture_commit',{rect:{x:200,y:200,w:width,h:80},monitorId:0});
  await until(async()=>{const source=await main.invoke('editor_source').catch(()=>null);return source?.width===width;},'Editor capture missing');
  const png=await readFile(join(dir,'editor-latest.png'));
  assert.equal(png.readUInt32BE(16),width);
  await pause(250);
 }
 const additions=(await readdir(dir)).filter(name=>!before.has(name));
 assert.ok(additions.every(name=>name==='editor-latest.png'),`Unexpected temporary files: ${additions}`);
 assert.deepEqual((await main.invoke('tray_list')).map(item=>item.id),tray);
 await main.invoke('editor_open_from_last');
 assert.equal((await main.invoke('editor_source')).width,103);
 const result={repeatedCaptures:3,latestCacheUpdated:true,newFiles:additions,noHiddenTrayCards:true,openLastCaptureWorks:true};
 await writeFile('work.local/editor-cache-result.json',JSON.stringify(result,null,2));console.log(result);
}finally{
 for(const key of ['auto_save','auto_copy','open_in_editor'])await main.invoke('settings_set',{key,value:original[key]});
 main.close();
}
