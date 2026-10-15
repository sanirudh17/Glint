// Small CDP client for the real local WebView2 runtime; no browser dependencies.
import { writeFile } from 'node:fs/promises';
export async function pages(port = Number(process.env.GLINT_CDP_PORT ?? 9227)) { return fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()); }
export async function connectPage(match, port = Number(process.env.GLINT_CDP_PORT ?? 9227)) {
  const list = await pages(port);
  const target = list.find(p => p.type === 'page' && (typeof match === 'string' ? p.url.includes(match) : match(p)));
  if (!target) throw new Error(`Page unavailable: ${JSON.stringify(list.map(p => ({title:p.title,url:p.url})))}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
  let id = 0; const pending = new Map();
  socket.addEventListener('message', e => { const message=JSON.parse(e.data); const waiter=pending.get(message.id); if (waiter) {pending.delete(message.id); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);} });
  const send = (method, params={}) => new Promise((resolve,reject) => { const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params})); });
  const evaluate = async expression => {const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.value ?? r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);return r.result.value;};
  return {target,send,evaluate,invoke:(cmd,args={})=>evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)},${JSON.stringify(args)})`),
    screenshot:async path=>{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(r.data,'base64'));},close:()=>socket.close()};
}
