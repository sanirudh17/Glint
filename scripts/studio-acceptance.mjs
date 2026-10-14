import { connectPage } from './studio-cdp.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root=process.argv[2]; const mode=process.argv[3] ?? 'inspect';
const fixture=JSON.parse(await readFile(join(root,'fixture.json'),'utf8'));
const page=await connectPage('/rec-trim');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  if(mode==='save') {
    await page.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Save project")?.click()');
    await pause(500);console.log('Project saved');
  }
  if(mode==='status') console.log(JSON.stringify({recording:await page.invoke('recorder_status'),body:await page.evaluate('document.body.innerText')}));
  if(mode==='inspect') {
    console.log(await page.evaluate('JSON.stringify({text:document.body.innerText,w:innerWidth,h:innerHeight,video:Array.from(document.querySelectorAll("video")).map(v=>({ready:v.readyState,error:v.error?.code,src:v.currentSrc})),canvas:document.querySelector("canvas")?.width})'));
    await page.screenshot(join(root,'studio-wide.png'));
  }
  if(mode==='ui') {
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y:100});
    await pause(200);
    console.log(await page.evaluate(`JSON.stringify({
      panel: (() => { const p=document.querySelector('.studio-panel'); return {
        padding:getComputedStyle(p).padding,
        hover:p.matches(':hover'), focused:p.matches(':focus-within'), active:document.activeElement?.outerHTML?.slice(0,200),
        scrollbarWidth:getComputedStyle(p,'::-webkit-scrollbar').width,
        scrollbarThumb:getComputedStyle(p,'::-webkit-scrollbar-thumb').backgroundColor
      }; })(),
      timeFont:getComputedStyle(document.querySelector('.trim-time')).fontSize,
      outputFont:getComputedStyle(document.querySelector('.trim-out')).fontSize,
      nativeSelects:document.querySelectorAll('select').length,
      nativeNumberInputs:document.querySelectorAll('input[type="number"]').length
    })`));
    await page.screenshot(join(root,'studio-compact.png'));
  }
  if(mode==='export' || mode==='cancel') {
    await page.invoke('recorder_open_trim',{id:-1,path:fixture.source});await pause(700);
    const start=Date.now();
    await page.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Export MP4").click()');
    if(mode==='cancel') {
      await pause(1200);
      await page.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Cancel export").click()');
    }
    let last=0;
    for(;;) {
      const text=await page.evaluate('document.body.innerText');
      const message=text.split('\n').find(s=>s.startsWith('Exported:') || s==='Export complete' || s.includes('cancelled') || s.includes('Export failed') || s.includes('Encoder stopped'));
      if(message){const result={mode,seconds:(Date.now()-start)/1000,message};console.log(JSON.stringify(result));await writeFile(join(root,`result-${mode}.json`),JSON.stringify(result,null,2));break;}
      if(Date.now()-start>600000)throw new Error(`Export timeout: ${text}`);
      if(Date.now()-last>10000){console.log(text.split('\n').find(s=>s.includes('Exporting'))??'Preparing export');last=Date.now();}
      await pause(500);
    }
  }
} finally {page.close();}
