import assert from 'node:assert/strict';
import {writeFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const engineId=process.argv[2]??'ppocrv6-small';assert.ok(['ppocrv6-small','ppocrv6-medium'].includes(engineId));
const main=await connectPage(t=>/^http:\/\/localhost:5175\/(#|$)/.test(t.url),9245);
const root=join(process.env.LOCALAPPDATA,'com.glint.validation.ocr-upgrade');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
 const already=await main.invoke('ocr_engine_status',{engine:engineId});
 if(!already){
  const cancelled=main.invoke('ocr_engine_install',{engine:engineId}).then(()=>({ok:true}),error=>({ok:false,error:String(error)}));await pause(300);await main.invoke('ocr_engine_cancel');
  const cancelResult=await cancelled;assert.equal(cancelResult.ok,false);assert.match(cancelResult.error,/cancelled/i);
  assert.equal(await main.invoke('ocr_engine_status',{engine:engineId}),false);
  assert.ok(!(await readdir(root)).some(n=>n.startsWith('.ocr-install-')));
  await main.invoke('ocr_engine_install',{engine:engineId});
 }
 assert.equal(await main.invoke('ocr_engine_status',{engine:engineId}),true);
 const engine=join(root,engineId==='ppocrv6-medium'?'ocr-ppv6-medium-1':'ocr-ppv6-small-1');const tier=engineId==='ppocrv6-medium'?'medium':'small';
 for(const name of ['onnxruntime.dll',`pp-ocrv6_${tier}_det.onnx`,`pp-ocrv6_${tier}_rec.onnx`,'ppocrv6_dict.txt','PP-OCR-LICENSE.txt','ONNX-Runtime-LICENSE.txt','ONNX-Runtime-ThirdPartyNotices.txt'])assert.ok((await stat(join(engine,name))).size>0,name);
 const result={passed:true,engineId,installed:true,cancellationAndRetry:!already,licenseNoticesPresent:true};await writeFile(join(process.env.LOCALAPPDATA,'GlintValidation','OcrUpgrade',`install-${engineId}-result.json`),JSON.stringify(result,null,2));console.log(result);
} finally {main.close();}
