// Exercise the real Export GIF button and its completion state, not only IPC.
import assert from 'node:assert/strict';
import {writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],source=join(root,'quick-fixture.mp4');
const main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const original=await main.invoke('studio_load',{path:source});
const settings=await main.invoke('settings_get_all');
let editor,owned,completed=false;
try {
  // Leave the final review export outside Temp and keep it in the QA library.
  await main.invoke('settings_set_save_dir',{path:join(process.env.LOCALAPPDATA,'GlintValidation','Phase5','Exports')});
  const project=structuredClone(original.project);
  project.look={...project.look,enabled:true,background:{type:'transparent'},padding:20,radius:20,shadow:20,aspect:'1:1',outputSize:{width:640,height:640}};
  await main.invoke('studio_save',{path:source,project});
  await main.invoke('recorder_open_trim',{id:-1,path:source});
  editor=await connectPage('/rec-trim');await editor.send('Page.reload');
  await pause(500);
  for(let i=0;i<120;i++){if(await editor.evaluate(`!!document.querySelector('.trim-gif') && ![...document.querySelectorAll('button')].find(b=>b.textContent==='Export GIF')?.disabled`))break;await pause(50);}
  assert.equal(await editor.evaluate(`!!document.querySelector('.trim-progress')`),false);
  const ids=new Set((await main.invoke('captures_list')).map(c=>c.id));
  await editor.evaluate(`document.querySelector('.trim-gif').open=true`);
  assert.equal(await editor.evaluate(`!!document.querySelector('input[aria-label="Transparent background"]')`),false,'Studio background is the only background control');
  const started=Date.now(),samples=[];
  await editor.evaluate(`window.__gifCalls=[];window.__gifOriginalInvoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async function(command,args,...rest){if(command==='recorder_gif_export')window.__gifCalls.push({command,time:Date.now()});return window.__gifOriginalInvoke.call(this,command,args,...rest)}`);
  await editor.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Export GIF').click()`);
  for(let i=0;i<600;i++){
    const state=await editor.evaluate(`({progress:document.querySelector('.trim-progress')?.textContent??null,error:document.querySelector('.studio-export-error')?.textContent??null,ready:![...document.querySelectorAll('button')].find(b=>b.textContent==='Export GIF')?.disabled})`);
    if(state.progress&&samples.at(-1)!==state.progress)samples.push(state.progress);
    assert.equal(state.error,null,JSON.stringify(await editor.evaluate('window.__gifCalls')));
    if(state.ready&&!state.progress)break;
    await pause(50);
  }
  const elapsedMs=Date.now()-started;
  assert.ok(samples.length>0,'button must enter export state');
  assert.equal(await editor.evaluate(`!!document.querySelector('.trim-progress')`),false,'finished export must leave progress state');
  owned=(await main.invoke('captures_list')).find(c=>!ids.has(c.id)&&c.kind==='gif');assert.ok(owned,'finished GIF must be published');
  await copyFile(owned.path,join(root,'ui-transparent.gif'));
  const saved=await main.invoke('studio_load',{path:source});assert.deepEqual(saved.project.look.background,project.look.background,'export-only transparency must not change the saved background');
  await editor.evaluate(`[...document.querySelectorAll('.studio-export-actions button')].find(b=>b.textContent.includes('Show in folder')).click()`);
  await pause(500);assert.equal(await editor.evaluate(`document.querySelector('.studio-export-error')?.textContent??null`),null);
  await editor.screenshot(join(root,'gif-controls-finished.png'));
  await writeFile(join(root,'gif-ui-result.json'),JSON.stringify({passed:true,elapsedMs,clipSeconds:3,samples,finished:true,savedBackgroundUnchanged:true,retainedReviewExport:owned.path},null,2));
  completed=true;
  console.log(JSON.stringify({passed:true,elapsedMs,samples}));
}finally{
  if(!completed){
    if(owned)await main.invoke('capture_delete',{id:owned.id});
    await main.invoke('studio_save',{path:source,project:original.project});
  }
  await main.invoke('settings_set_save_dir',{path:settings.save_dir});
  editor?.close();main.close();
}
