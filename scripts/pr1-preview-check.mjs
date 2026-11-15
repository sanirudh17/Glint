// Owned-fixture checks for the isolated PR1 preview. Never target the installed app.
import assert from 'node:assert/strict';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const port=9231,url='http://127.0.0.1:5181/';
const root=join(process.env.LOCALAPPDATA,'GlintValidation','PR1Implementation');await mkdir(root,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const main=await connectPage(t=>t.url===url||t.url.startsWith(url+'#'),port);
const report={};let trim;let originalRelease;
const click=async(page,selector)=>{await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.click();})()`);await wait(60);};
const button=async(page,text)=>{await page.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing '+${JSON.stringify(text)});e.click();})()`);await wait(70);};
try{
 await main.evaluate(`(()=>{window.__pr1Errors=[];addEventListener('error',e=>window.__pr1Errors.push(e.message));addEventListener('unhandledrejection',e=>window.__pr1Errors.push(String(e.reason)));location.hash='#/settings';})()`);await wait(180);
 await button(main,'Capture');
 originalRelease=await main.evaluate(`document.querySelector('[aria-label="Capture on mouse release"]').checked`);
 if(originalRelease)await click(main,'[aria-label="Capture on mouse release"]');
 assert.equal(await main.evaluate(`document.querySelector('[aria-label="Capture on mouse release"]').checked`),false);
 assert.ok(await main.evaluate(`!!document.querySelector('[aria-label="Open in editor after capture"]')`));
 await click(main,'[aria-label="Capture on mouse release"]');
 assert.equal((await main.invoke('settings_get_all')).capture_on_release,true);
 await main.screenshot(join(root,'capture-settings.png'));
 await click(main,'[aria-label="Capture on mouse release"]');
 assert.equal((await main.invoke('settings_get_all')).capture_on_release,false);
 await button(main,'Auto-save');assert.equal(await main.evaluate(`document.body.innerText.includes('Open in editor after capture')`),false);
 report.settings={manualCaptureMode:true,toggleWorks:true,editorPreferenceMoved:true};

 await main.evaluate(`location.hash='#/library'`);await wait(250);
 await main.evaluate(`(()=>{const card=[...document.querySelectorAll('.cap-card')].find(e=>e.querySelector('button[aria-label="Annotate"]'));if(!card)throw Error('No screenshot fixture');card.scrollIntoView({block:'center'});window.__pr1Card=card;})()`);
 const hover=await main.evaluate(`(()=>{const r=window.__pr1Card.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+24};})()`);
 await main.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});await wait(60);
 const actions=await main.evaluate(`({labels:[...window.__pr1Card.querySelectorAll('.cap-actions button')].map(b=>b.getAttribute('aria-label')),opacity:getComputedStyle(window.__pr1Card.querySelector('.cap-actions')).opacity,images:[...document.querySelectorAll('.cap-thumb img')].filter(i=>i.complete&&i.naturalWidth).length})`);
 assert.equal(actions.opacity,'1');assert.ok(actions.images>0);assert.ok(actions.labels.includes('Copy')&&actions.labels.includes('Annotate')&&actions.labels.includes('Delete'));
 await main.evaluate(`window.__pr1Card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);assert.equal(await main.evaluate(`!!document.querySelector('.capture-menu')`),false);
 await main.screenshot(join(root,'hover-actions.png'));report.hover=actions;

 // Exercise a real capture with the setting off and on, reusing the warmed overlay.
 const trayBefore=(await main.invoke('tray_list')).length;
 const draw=async()=>{
  await main.invoke('capture_start',{mode:'area'});const overlay=await connectPage(t=>t.url.includes('#/overlay?monitor=0'),port);
  for(let i=0;i<40;i++){if(await overlay.evaluate(`!!document.querySelector('.sl-layer')`))break;await wait(100);}
  const data=await overlay.invoke('capture_overlay_meta',{monitorId:0});
  await overlay.send('Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:100,button:'left',buttons:1,clickCount:1});
  await overlay.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:260,y:210,button:'left',buttons:1});
  await wait(70);
  assert.equal(await overlay.evaluate(`document.querySelectorAll('.sl-handle').length`),data.capture_on_release?0:8);
  if(data.capture_on_release)assert.equal(await overlay.evaluate(`getComputedStyle(document.querySelector('.sl-rect')).outlineStyle`),'dashed');
  await overlay.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:240,y:220,button:'left',buttons:0,clickCount:1});
  return {overlay,data};
 };
 let capture=await draw();assert.equal(capture.data.capture_on_release,false);await wait(100);assert.equal((await main.invoke('tray_list')).length,trayBefore);
 await capture.overlay.invoke('capture_cancel');capture.overlay.close();await wait(150);
 await main.invoke('settings_set',{key:'capture_on_release',value:true});
 capture=await draw();assert.equal(capture.data.capture_on_release,true);
 for(let i=0;i<40;i++){if((await main.invoke('tray_list')).length>trayBefore)break;await wait(100);}
 const added=(await main.invoke('tray_list')).at(-1);assert.ok(added&&added.width>0&&added.height>0);
 capture.overlay.close();await main.invoke('settings_set',{key:'capture_on_release',value:false});
 report.capture={manualModeWaitsForConfirmation:true,warmOverlayUsesFreshPreference:true,releaseCaptures:true,noReleaseHandles:true,dashedOutline:true,size:[added.width,added.height]};console.log(JSON.stringify({capture:report.capture}));

 const video=join(root,'PR1 cursor controls demo.mp4');
 await copyFile(join(process.env.LOCALAPPDATA,'GlintValidation','StudioReliability','fixtures','cut-tones-source.mp4'),video);
 await main.invoke('studio_import',{path:video});
 const eventsPath=video+'.glint-studio/events.json',events=JSON.parse(await readFile(eventsPath,'utf8'));
 events.events=[{kind:'cursor',t:0,x:40,y:80},{kind:'cursor',t:1,x:200,y:80},{kind:'click',t:1,x:200,y:80,down:true},{kind:'cursor',t:2,x:270,y:140}];await writeFile(eventsPath,JSON.stringify(events));
 await main.invoke('recorder_open_trim',{id:-1,path:video});trim=await connectPage(t=>t.url.includes('#/rec-trim'),port);
 for(let i=0;i<60;i++){if(await trim.evaluate(`document.querySelector('.studio-project-name')?.textContent==='PR1 cursor controls demo'&&document.querySelector('.trim-video')?.readyState>=2`))break;await wait(100);}
 const tabs=await trim.evaluate(`[...document.querySelectorAll('.studio-panel-tabs button')].map(b=>b.textContent)`);assert.deepEqual(tabs,['Look','Edit & draw','Polish']);
 await button(trim,'Edit & draw');assert.ok(await trim.evaluate(`document.querySelector('[aria-label="Cursor smoothing"]').getBoundingClientRect().height>0`));
 const headerBefore=await trim.evaluate(`document.querySelector('.studio-panel-header').getBoundingClientRect().top`);
 await trim.evaluate(`document.querySelector('.studio-panel-controls').scrollTop=900`);
 assert.equal(await trim.evaluate(`document.querySelector('.studio-panel-header').getBoundingClientRect().top`),headerBefore);
 assert.equal(await trim.evaluate(`[...document.querySelectorAll('[aria-label="Window controls"]')].filter(e=>e.getBoundingClientRect().height>0).length`),1);
 assert.equal(await trim.invoke('plugin:window|is_maximized',{label:'rec-trim'}),true);
 await trim.evaluate(`document.querySelector('.studio-panel-controls').scrollTop=0`);
 assert.equal(await trim.evaluate(`getComputedStyle(document.querySelector('.studio-panel-controls')).paddingLeft`),'24px');
 await trim.screenshot(join(root,'studio-edit-controls.png'));
 await button(trim,'Edit & draw');assert.ok(await trim.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Draw crop on video')`));
 await button(trim,'Look');await trim.evaluate(`document.querySelector('[aria-label="Output size preset"]').click()`);await wait(50);await trim.evaluate(`[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Custom size').click()`);await wait(70);
 assert.ok(await trim.evaluate(`!!document.querySelector('[aria-label="Export width"]')`));
 await button(trim,'Polish');await trim.screenshot(join(root,'studio-fixed-header.png'));
 report.studio={tabs,fixedHeader:true,oneWindowControlGroup:true,maximized:true,cropAndSizingRetained:true};
 report.errors=await main.evaluate(`window.__pr1Errors`);assert.deepEqual(report.errors,[]);
 await writeFile(join(root,'checks.json'),JSON.stringify({passed:true,...report},null,2));console.log(JSON.stringify({passed:true,...report}));
}finally{
 if(originalRelease!==undefined){await main.evaluate(`location.hash='#/settings'`);await wait(180);await button(main,'Capture');if(await main.evaluate(`document.querySelector('[aria-label="Capture on mouse release"]').checked`)!==originalRelease)await click(main,'[aria-label="Capture on mouse release"]');}
 trim?.close();main.close();
}
