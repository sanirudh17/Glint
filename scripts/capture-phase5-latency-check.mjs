import {connectPage,pages} from './studio-cdp.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
for(const [label,port] of [['installedBaseline',9240],['developmentPreview',9242]]){
 let main;
 for(const target of await pages(port)){
  if(target.type!=='page')continue;
  const candidate=await connectPage(t=>t.id===target.id,port);
  if(await candidate.evaluate("window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label==='main'")){main=candidate;break;}
  candidate.close();
 }
 if(!main)throw Error('Main window not found');
 const samples=[];
 try{
  for(let trial=0;trial<6;trial++){
   const started=performance.now();await main.invoke('capture_start',{mode:'area'});
   for(let i=0;i<200;i++){const meta=await main.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null);if(meta){samples.push(Math.round(performance.now()-started));break;}await pause(5);}
   await main.invoke('capture_cancel',{monitorId:0});await pause(500);
  }
  await main.evaluate(`location.hash='#/library'`);await pause(1000);
  results.push({label,port,coldMs:samples[0],warmMs:samples.slice(1)});
 }finally{main.close();}
}
await writeFile(join(process.argv[2],'latency-result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
