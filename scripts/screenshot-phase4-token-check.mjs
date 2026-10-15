// Token OCR regression and end-to-end native scan latency on fake data only.
// Run against the isolated validation instance with GLINT_CDP_PORT set.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],p=await connectPage('/editor'),samples=[];
const expected=['Email','Card number','Phone','IP address','API key','JWT'];
try {
  for(const scale of [1,.75,.5])for(const theme of ['light','dark']) {
    const file=`tokens-${scale}-${theme}.png`,pngBase64=(await readFile(join(root,file))).toString('base64');
    const start=performance.now(),found=await p.invoke('privacy_scan',{pngBase64,requestId:crypto.randomUUID()}),ms=Math.round(performance.now()-start),kinds=found.map(s=>s.kind);
    for(const kind of expected)assert.ok(kinds.includes(kind),`${file} missed ${kind}: ${kinds}`);
    samples.push({file,ms,kinds});
  }
  // Repeat the originally failing half-size input to report warm-run latency.
  const warm=[];for(let i=0;i<3;i++) {
    const pngBase64=(await readFile(join(root,'tokens-0.5-light.png'))).toString('base64'),start=performance.now();
    const found=await p.invoke('privacy_scan',{pngBase64,requestId:crypto.randomUUID()});
    assert.ok(found.some(s=>s.kind==='JWT'));warm.push(Math.round(performance.now()-start));
  }
  const result={passed:true,samples,warmHalfSizeMs:warm};await writeFile(join(root,'token-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{p.close();}
