// Run against an owned local build with WebView2 debugging on GLINT_CDP_PORT.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { connectPage } from './studio-cdp.mjs';
const expectedVersion=process.argv[2]??JSON.parse(await readFile(new URL('../glint/package.json',import.meta.url),'utf8')).version;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const value = await check();
    if (value) return value;
    await pause(100);
  }
  throw new Error(message);
}

const main = await connectPage(p => !/\/(overlay|rec-select|editor|hud)/.test(p.url.split('#')[1] ?? ''));
const original = await main.invoke('settings_get_all');
const clients = [main];
const results = {};
try {
  assert.equal(await main.invoke('app_version'), expectedVersion);
  for (const [key,value] of Object.entries({auto_save:false,auto_copy:false,quick_access_auto_close:false})) {
    await main.invoke('settings_set', {key,value});
  }
  await main.evaluate("location.hash='/settings'");
  await until(() => main.evaluate("!![...document.querySelectorAll('button')].find(b=>b.textContent==='Capture')"), 'Settings unavailable');
  await main.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Capture').click()");
  const toggle = 'document.querySelector(\'input[aria-label="Open in editor after capture"]\')';
  await until(() => main.evaluate(`!!${toggle}`), 'Editor setting missing from Capture');

  async function setEditor(enabled) {
    await main.evaluate(`if (${toggle}.checked !== ${enabled}) ${toggle}.click()`);
    await until(async () => (await main.invoke('settings_get_all')).open_in_editor === enabled, 'Toggle did not reach backend');
  }

  async function capture(from,to,editorOnly=false) {
    await pause(500);
    const before = (await main.invoke('tray_list')).at(-1)?.id;
    const beforePresentation = editorOnly ? (await main.invoke('editor_source').catch(()=>null))?.presentation_id : undefined;
    await main.invoke('capture_start', {mode:'area'});
    const overlay = await until(() => connectPage('/overlay').catch(() => null), 'Overlay unavailable');
    clients.push(overlay);
    await until(() => overlay.evaluate("!!document.querySelector('.sl-layer')"), 'Selection unavailable');
    const meta = await overlay.invoke('capture_overlay_meta', {monitorId:0});
    await overlay.send('Input.dispatchMouseEvent', {type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});
    await overlay.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:to.x-10,y:to.y-10,buttons:1});
    await overlay.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:to.x,y:to.y,button:'left',buttons:0,clickCount:1});
    const item = !editorOnly && await until(async () => {
      const latest = (await main.invoke('tray_list')).at(-1);
      return latest && latest.id !== before && latest;
    }, 'Mouse release did not produce a capture without Enter');
    const source = editorOnly && await until(async () => {
      const value=await main.invoke('editor_source').catch(()=>null);
      return value && value.presentation_id!==beforePresentation && value.width===Math.round(Math.abs(to.x-from.x)*meta.scale) && value.height===Math.round(Math.abs(to.y-from.y)*meta.scale) && value;
    }, 'Mouse release did not open the capture in the editor');
    const png = source ? Buffer.from(source.image_data_url.split(',')[1],'base64') : await readFile(item.path);
    assert.equal(png.subarray(1,4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), Math.round(Math.abs(to.x-from.x)*meta.scale));
    assert.equal(png.readUInt32BE(20), Math.round(Math.abs(to.y-from.y)*meta.scale));
    return {width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
  }

  await setEditor(false);
  const first = await capture({x:200,y:200},{x:500,y:400});
  clients.push(await until(() => connectPage('/hud').catch(() => null), 'Quick Access did not open with editor off'));
  results.editorOff = {...first,quickAccess:true};
  await setEditor(true);
  const trayBefore = (await main.invoke('tray_list')).map(item=>item.id);
  const second = await capture({x:600,y:500},{x:200,y:200},true);
  assert.deepEqual((await main.invoke('tray_list')).map(item=>item.id),trayBefore,'Editor captures must not add hidden Quick Access cards');
  const editor = await until(() => connectPage('/editor').catch(() => null), 'Editor did not open automatically');
  clients.push(editor);
  const source = await editor.invoke('editor_source');
  assert.equal(source.width, second.width);
  assert.equal(source.height, second.height);
  results.editorOn = {...second,origin:source.origin};
  results.releaseWithoutEnter = true;
  results.reverseDrag = true;
  results.noHiddenEditorCards = true;
  await setEditor(original.open_in_editor);
  await mkdir('work.local', {recursive:true});
  await writeFile('work.local/capture-release-result.json', JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  for (const key of ['auto_save','auto_copy','quick_access_auto_close','open_in_editor']) {
    await main.invoke('settings_set', {key,value:original[key]});
  }
  for (const client of clients) client.close();
}
