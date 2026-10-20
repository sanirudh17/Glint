// Actual on-screen Chromium -> xcap -> settled strips -> editable PNG, compared
// against the browser's unrolled page. Optional auto mode tests native wheel input.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
// Connect before opening a visible fixture, so a restarting dev app cannot leave
// an orphan test browser behind.
const main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/'),9242);
await mkdir(root,{recursive:true});
const html=await readFile(new URL('./fixtures/phase5-scroll.html',import.meta.url));
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const large=!!process.env.GLINT_SCROLL_LARGE;
const profile=await mkdtemp(join(root,'chrome-check-'));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[`--user-data-dir=${profile}`,'--remote-debugging-port=9251','--no-first-run','--no-default-browser-check','--disable-session-crashed-bubble','--force-device-scale-factor=1','--window-position=0,0','--window-size=1150,850',`${large?'':'--app='}http://127.0.0.1:${port}/page`],{stdio:'ignore'});
const ffmpeg='glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe';
const rgba=(png)=>execFileSync(ffmpeg,['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{input:png,windowsHide:true,maxBuffer:64*1024*1024});
let chrome;const results=[];let selection=false,scroll=false;
const latest=join(process.env.USERPROFILE,'.glint','latest.png');
const mirror=await readFile(latest).catch(()=>null),outputs=[];
const originalTheme=(await main.invoke('settings_get_all')).theme;
async function until(fn,message,seconds=15){const start=Date.now();for(;;){const value=await fn();if(value)return value;if(Date.now()-start>seconds*1000)throw new Error(message);await pause(100);}}
try{
  chrome=await until(()=>connectPage(t=>t.url.startsWith(`http://127.0.0.1:${port}`),9251).catch(()=>null),'Chrome did not start');
  if(large){const {windowId}=await chrome.send('Browser.getWindowForTarget',{targetId:chrome.target.id});await chrome.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'maximized'}});}
  await main.invoke('settings_set',{key:'image_format',value:'png'});
  for(const mode of ['page','chat'].filter(mode=>!process.env.GLINT_SCROLL_ONLY||process.env.GLINT_SCROLL_ONLY===mode)){
    const theme=mode==='page'?'dark':'light';
    if(process.env.GLINT_SCROLL_LIFECYCLE)await main.invoke('settings_set',{key:'theme',value:theme});
    await chrome.send('Page.navigate',{url:`http://127.0.0.1:${port}/${mode}`});await pause(250);await chrome.send('Page.bringToFront');
    if(large){await chrome.evaluate(`(()=>{Object.assign(document.querySelector('#region').style,{left:'16px',top:'16px',width:(innerWidth-32)+'px',height:(innerHeight-32)+'px'});document.querySelector('#scroller').style.marginLeft='300px';const side=document.createElement('aside');side.style.cssText='position:absolute;left:2px;top:46px;bottom:34px;width:296px;padding:24px;background:#273541;color:white';side.innerHTML='<h2>Navigation</h2><p>Project notes</p><p>Messages</p><p>Settings</p>';document.querySelector('#region').append(side);})()`);await pause(250);}
    if(!process.env.GLINT_MANUAL_FOCUS){
    const focus=JSON.parse(execFileSync('C:/Users/sanir/AppData/Local/Programs/orca/resources/bin/orca.exe',['computer','get-app-state','--app',`pid:${browser.pid}`,'--restore-window','--no-screenshot','--json'],{encoding:'utf8',windowsHide:true}));
    await writeFile(join(root,`${mode}-window-state.json`),JSON.stringify(focus,null,2));
    assert.ok(focus.ok,'Chrome window could not be observed');
    const ownWindow=focus.result.snapshot.window;
    const clicked=JSON.parse(execFileSync('C:/Users/sanir/AppData/Local/Programs/orca/resources/bin/orca.exe',['computer','click','--app',`pid:${browser.pid}`,'--window-id',String(ownWindow.id),'--x','50','--y','100','--no-screenshot','--json'],{encoding:'utf8',windowsHide:true}));
    await writeFile(join(root,`${mode}-click-state.json`),JSON.stringify(clicked,null,2));
    }
    if(process.env.GLINT_PIN_FIXTURE){
      execFileSync('powershell.exe',['-NoProfile','-File','scripts/inspect-owned-window.ps1','-TargetPid',String(browser.pid),'-Pin'],{windowsHide:true});
    }else{
      console.log('Waiting for the local Glint manual scroll check window to be brought to the front.');
      await until(async()=>{
        const windows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','scripts/inspect-owned-window.ps1','-TargetPid',String(browser.pid)],{encoding:'utf8',windowsHide:true}));
        return windows.some(w=>w.visible&&w.foreground);
      },'The local fixture needs to be in front for a desktop capture',180);
      await pause(1000);
      await until(()=>chrome.evaluate('document.hasFocus()'),'The local fixture needs to remain in front for a desktop capture',180);
    }
    await pause(700);
    const ids=new Set((await main.invoke('captures_list')).map(c=>c.id));
    await main.invoke('capture_scroll_begin');
    selection=true;
    const meta=await until(()=>main.invoke('capture_overlay_meta',{monitorId:0}).catch(()=>null),'No region selection appeared');
    const frame=await main.invoke('capture_overlay_data',{monitorId:0});
    console.log('Fresh selection metadata',JSON.stringify({width:meta.width,height:meta.height,scale:meta.scale}));
    await chrome.screenshot(join(root,`${mode}-browser.png`));
    const raw=rgba(Buffer.from(frame.image_data_url.split(',')[1],'base64'));
    let x=meta.width,y=meta.height,right=0,bottom=0;
    for(let row=0;row<meta.height;row++)for(let col=0;col<meta.width;col++){
      const i=(row*meta.width+col)*4;
      if(Math.abs(raw[i]-1)<=3&&Math.abs(raw[i+1]-254)<=3&&Math.abs(raw[i+2]-197)<=3){x=Math.min(x,col);right=Math.max(right,col);y=Math.min(y,row);bottom=Math.max(bottom,row);}
    }
    if(!(right>x&&bottom>y)){console.log(execFileSync('powershell.exe',['-NoProfile','-File','scripts/inspect-owned-window.ps1','-TargetPid',String(browser.pid)],{encoding:'utf8',windowsHide:true}));}
    assert.ok(right>x&&bottom>y,'The visible Chrome fixture border was not captured');
    const regionWidth=right-x+1,regionHeight=bottom-y+1;
    const workHeight=large?await chrome.evaluate('Math.round(screen.availHeight*devicePixelRatio)'):0;
    const width=large?meta.width:regionWidth,height=large?workHeight:regionHeight;
    const selectX=large?0:x,selectY=large?0:y;
    if(!large){assert.equal(width,800);assert.equal(height,480);}else{assert.ok(width>=1500&&height>=900,'Expected a full-width browser selection above the taskbar');}
    let overlay,delayed;
    if(process.env.GLINT_SCROLL_LIFECYCLE){overlay=await connectPage('/overlay?monitor=0',9242);delayed=overlay.evaluate(`(()=>{const end=Date.now()+400;while(Date.now()<end){}return true;})()`);}
    await main.invoke('capture_commit',{rect:{x:selectX/meta.scale,y:selectY/meta.scale,w:width/meta.scale,h:height/meta.scale},monitorId:0});
    if(delayed){await delayed;overlay.close();}
    selection=false;scroll=true;
    await until(async()=>{const s=await main.invoke('capture_scroll_status');return s.active&&s;},'Scrolling worker did not start');
    const visibleController=await until(()=>connectPage('/rec-scroll',9242).catch(()=>null),'Controller did not load');
    await until(()=>main.invoke('plugin:window|is_visible',{label:'rec-scroll'}),'Controller did not reveal after painting');
    await until(async()=>{const s=await main.invoke('capture_scroll_status');return s.ready;},'Capture did not finish preparing');
    assert.equal(await visibleController.evaluate("!!document.querySelector('.scroll-controller-message')?.textContent.trim()"),true);
    if(process.env.GLINT_SCROLL_LIFECYCLE){assert.equal(await visibleController.evaluate('document.documentElement.dataset.theme'),theme);assert.equal(await visibleController.evaluate("getComputedStyle(document.body).backgroundColor"),'rgba(0, 0, 0, 0)');}
    await visibleController.screenshot(join(root,`${mode}-controller-first-visible.png`));visibleController.close();
    const max=await chrome.evaluate(`document.querySelector('#scroller').scrollHeight-document.querySelector('#scroller').clientHeight`);
    let steps=0;
    if(process.env.GLINT_SCROLL_AUTO){
      await main.invoke('capture_scroll_control',{action:'start'});
      await until(async()=>{const s=await main.invoke('capture_scroll_status');return s.height>height+60;},'Automatic wheel steps did not extend the capture',15);
      await main.invoke('capture_scroll_control',{action:'pause'});await pause(800);
      const paused=await chrome.evaluate(`document.querySelector('#scroller').scrollTop`);await pause(1000);
      assert.equal(await chrome.evaluate(`document.querySelector('#scroller').scrollTop`),paused,'Pause must stop automatic wheel input');
      await main.invoke('capture_scroll_control',{action:'start'});
      await until(async()=>{const s=await main.invoke('capture_scroll_status');if(s.height===height+max&&!s.autoScrolling)return s;if(!s.autoScrolling&&s.message.includes('Could not align'))throw Error(JSON.stringify(s));return false;},'Auto-scroll did not reach and pause at the bottom',90);
      const bottom=await main.invoke('capture_scroll_status');assert.ok(bottom.message.includes('stopped advancing'));
      steps=bottom.strips-1;
    }else{
    for(let offset=140;offset<max+140;offset+=140){
      const target=Math.min(offset,max);await chrome.evaluate(`document.querySelector('#scroller').scrollTop=${target}`);
      await until(async()=>{const s=await main.invoke('capture_scroll_status');if(s.height===height+target)return s;return false;},`Could not stitch ${mode} at ${target}`,12);steps++;
    }
    }
    const controller=await connectPage('/rec-scroll',9242);await controller.screenshot(join(root,`${mode}-controller.png`));controller.close();
    await main.invoke('capture_scroll_control',{action:'finish'});
    const capture=await until(async()=>(await main.invoke('captures_list')).find(c=>!ids.has(c.id)&&c.width===width&&c.height===height+max),'Finished PNG was not saved');
    const editor=await until(()=>connectPage('/editor',9242).catch(()=>null),'Editable result did not open');
    scroll=false;
    const source=await editor.invoke('editor_source');assert.equal(source.width,width);assert.equal(source.height,height+max);
    await editor.screenshot(join(root,`${mode}-editor.png`));
    await editor.invoke('plugin:window|close',{label:'editor'});editor.close();
    const bounds=await chrome.evaluate('expandForGolden()');
    const screenshot=await chrome.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,scale:1}});
    const golden=Buffer.from(screenshot.data,'base64'),actual=await readFile(capture.path);
    outputs.push(actual);
    await writeFile(join(root,`${mode}-expected.png`),golden);await writeFile(join(root,`${mode}-stitched.png`),actual);
    let a=rgba(actual);const b=rgba(golden);
    if(large){const stride=width*4;const crop=Buffer.alloc(regionWidth*(regionHeight+max)*4);for(let row=0;row<regionHeight+max;row++){a.copy(crop,row*regionWidth*4,(row+y)*stride+x*4,(row+y)*stride+(x+regionWidth)*4);}a=crop;}
    assert.equal(a.length,b.length);
    let differing=0,maxError=0;for(let i=0;i<a.length;i+=4){let bad=false;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);maxError=Math.max(maxError,d);if(d>2)bad=true;}if(bad)differing++;}
    // Screen and compositor can differ in font rasterization; save the exact
    // difference count and require matching geometry and a very small fraction.
    assert.ok(differing/(a.length/4)<0.001,`${mode}: ${differing} pixels differ, max error ${maxError}`);
    results.push({mode,width,height:height+max,steps,differingPixels:differing,maxChannelError:maxError,scale:meta.scale,path:capture.path});
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(join(root,`${large?'scroll-large':process.env.GLINT_SCROLL_AUTO?'scroll-auto':'scroll'}-result.json`),JSON.stringify({passed:true,results},null,2));
}catch(error){
  await writeFile(join(root,'scroll-failure.json'),JSON.stringify({error:String(error),status:await main.invoke('capture_scroll_status').catch(()=>null)},null,2));
  if(chrome)await chrome.screenshot(join(root,'scroll-failure-browser.png')).catch(()=>{});
  throw error;
}finally{
  if(scroll)await main.invoke('capture_scroll_control',{action:'cancel'}).catch(()=>{});
  if(selection)await main.invoke('capture_cancel',{monitorId:0}).catch(()=>{});
  if(process.env.GLINT_SCROLL_LIFECYCLE)await main.invoke('settings_set',{key:'theme',value:originalTheme}).catch(()=>{});
  await pause(500);const current=await readFile(latest).catch(()=>null);
  if(mirror&&current&&outputs.some(b=>b.equals(current)))await writeFile(latest,mirror);
  main.close();
  if(chrome){await chrome.send('Browser.close').catch(()=>{});chrome.close();}else browser.kill();
  server.close();
}
