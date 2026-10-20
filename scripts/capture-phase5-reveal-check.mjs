// Verify the Shell's actual selected item, including forward-slash export paths.
import assert from 'node:assert/strict';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectPage} from './studio-cdp.mjs';
const root=process.argv[2],folder=join(root,'Reveal — spaces, & café'),path=join(folder,'Glint — exported, image & café.gif');
await mkdir(folder,{recursive:true});await copyFile(join(root,'quick.gif'),path);
const main=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/'));
const ps=code=>execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true}).trim();
const list=()=>JSON.parse(ps(`$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$shell=New-Object -ComObject Shell.Application; $found=@(foreach($w in $shell.Windows()){try{[pscustomobject]@{hwnd=[long]$w.HWND;folder=$w.Document.Folder.Self.Path;selected=@($w.Document.SelectedItems()|ForEach-Object {$_.Path})}}catch{}});ConvertTo-Json -InputObject $found -Depth 4 -Compress`));
const before=new Set(list().map(w=>w.hwnd));let found;
try {
  await main.invoke('reveal_path',{path:path.replaceAll('\\','/')});
  for(let i=0;i<20;i++){found=list().find(w=>w.folder.toLowerCase()===folder.toLowerCase()&&w.selected.some(p=>p.toLowerCase()===path.toLowerCase()));if(found)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(found,'Explorer must open the actual parent and select the exact exported file');
  await assert.rejects(main.invoke('reveal_path',{path:join(folder,'not-here.gif')}),/no longer on disk/);
  await writeFile(join(root,'reveal-result.json'),JSON.stringify({passed:true,forwardSlashes:true,unicodeSpacesCommasAmpersand:true,exactFolder:true,exactSelection:true,missingFileError:true},null,2));
  console.log('Explorer opened the correct folder and selected the exact Unicode export; missing files report an error.');
}finally{
  if(found&&!before.has(found.hwnd))ps(`$shell=New-Object -ComObject Shell.Application;foreach($w in $shell.Windows()){if([long]$w.HWND -eq ${found.hwnd}){$w.Quit()}}`);
  main.close();
}
