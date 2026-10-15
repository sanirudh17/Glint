// Real settings persistence, index cancellation, and corrupt-file recovery.
import assert from 'node:assert/strict';
import {copyFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
const editor=await connectPage('/editor'),main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/'));
const db=await editor.invoke('plugin:sql|load',{db:'sqlite:glint.db'}),owned=[],checks=[];
const query=(query,values=[])=>editor.invoke('plugin:sql|select',{db,query,values});
async function until(fn,why){for(let i=0;i<2400;i++){const value=await fn();if(value)return value;await pause(50);}throw Error('Timed out: '+why);}
async function idle(){return until(async()=>{const p=await editor.invoke('library_index_status');return !p.running&&p;},'index idle');}
async function settings(){await main.evaluate('location.hash="#/settings"');await until(()=>main.evaluate('!!document.querySelector(".settings-nav")'),'settings navigation');await main.evaluate('Array.from(document.querySelectorAll(".settings-nav button")).find(b=>b.textContent.trim()==="Auto-save").click()');}
async function toggle(label,key,value){
  await until(()=>main.evaluate(`!!document.querySelector('[aria-label="${label}"]')`),label);
  if(await main.evaluate(`document.querySelector('[aria-label="${label}"]').checked`)===value){await main.evaluate(`document.querySelector('[aria-label="${label}"]').click()`);await pause(100);}
  await main.evaluate(`document.querySelector('[aria-label="${label}"]').click()`);
  await until(async()=>{const r=await query('SELECT value FROM settings WHERE key=$1',[key]);return r.length&&JSON.parse(r[0].value)===value;},key+' persistence');
}
async function capture(name,broken=false){
  const path=join(root,name+'.png');if(broken)await writeFile(path,'not an image');else await copyFile(join(root,'source.png'),path);
  await editor.invoke('plugin:sql|execute',{db,query:"INSERT INTO captures(kind,path,width,height,created_at) VALUES('screenshot',$1,1600,760,$2)",values:[path,Math.floor(Date.now()/1000)]});
  const row=(await query('SELECT id FROM captures WHERE path=$1 AND deleted_at IS NULL',[path]))[0];assert.ok(row);owned.push(row.id);return row.id;
}
try{
  await editor.invoke('library_index_cancel');await idle();await settings();
  await toggle('Search screenshot text','index_screenshot_text',true);
  await toggle('Name captures from text','auto_name_captures',false);
  const id=await capture('naming-off');await editor.invoke('library_index_start');await idle();
  assert.equal((await query('SELECT title FROM captures WHERE id=$1',[id]))[0].title,null);
  await main.screenshot(join(root,'settings-ui.png'));
  checks.push('Naming switch persists and newly indexed captures stay unnamed when off');console.log(checks.at(-1));
  await toggle('Name captures from text','auto_name_captures',true);
  const cancelledIds=[];for(let i=0;i<3;i++)cancelledIds.push(await capture('cancel-'+i));
  await main.evaluate('location.hash="#/library"');
  await until(()=>main.evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Cancel text scan")'),'cancel button');
  await main.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Cancel text scan").click()');
  const cancelled=await idle();assert.ok(cancelled.done<cancelled.total,JSON.stringify(cancelled));
  checks.push('Library cancel returns control before completing its batch');console.log(checks.at(-1));
  for(const id of cancelledIds)await editor.invoke('capture_delete',{id});
  await capture('broken',true);
  for(let i=0;i<2;i++){await editor.invoke('library_index_start');const result=await idle();assert.ok(result.errors>=1,JSON.stringify(result));}
  checks.push('Corrupt images remain retryable on subsequent scans');console.log(checks.at(-1));
  await settings();await toggle('Search screenshot text','index_screenshot_text',false);await idle();
  assert.equal((await query('SELECT count(*) AS n FROM capture_text_fts'))[0].n,0);
  await toggle('Search screenshot text','index_screenshot_text',true);await editor.invoke('library_index_cancel');await idle();
  checks.push('Search off switch persists and clears FTS text');console.log(checks.at(-1));
  await writeFile(join(root,'edge-result.json'),JSON.stringify({passed:true,checks},null,2));
}finally{
  await editor.invoke('library_index_cancel');await idle();
  for(const id of owned)await editor.invoke('capture_delete',{id});
  editor.close();main.close();
}
