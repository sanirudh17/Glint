// Called by the STA clipboard wrapper, against the isolated validation app only.
import {connectPage} from './studio-cdp.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [root,kind]=process.argv.slice(2),p=await connectPage(t=>t.url==='http://localhost:5173/'||t.url.startsWith('http://localhost:5173/#/'),9242);
let id,path;
try{
 const settings=await p.invoke('settings_get_all');if(!settings.save_dir.includes('GlintValidation'))throw Error('Validation identity required');
 path=join(root,`clipboard-check.${kind==='gif'?'gif':'mp4'}`);
 // CF_HDROP carries the file unchanged; decoding is intentionally unnecessary.
 await writeFile(path,kind==='gif'?Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'):Buffer.from('Glint file clipboard validation'));
 const db=await p.invoke('plugin:sql|load',{db:'sqlite:glint.db'});
 await p.invoke('plugin:sql|execute',{db,query:'DELETE FROM captures WHERE path=$1',values:[path]});
 await p.invoke('plugin:sql|execute',{db,query:'INSERT INTO captures (kind,path,created_at) VALUES ($1,$2,$3)',values:[kind,path,Math.floor(Date.now()/1000)]});
 id=(await p.invoke('plugin:sql|select',{db,query:'SELECT id FROM captures WHERE path=$1 ORDER BY id DESC LIMIT 1',values:[path]}))[0].id;
 await p.invoke('capture_copy',{id});console.log(path);
 await p.invoke('plugin:sql|execute',{db,query:'DELETE FROM captures WHERE id=$1',values:[id]});id=null;
}finally{
 // The wrapper deletes the file after inspecting the OS clipboard, before restore.
 if(id){const db=await p.invoke('plugin:sql|load',{db:'sqlite:glint.db'});await p.invoke('plugin:sql|execute',{db,query:'DELETE FROM captures WHERE id=$1',values:[id]}).catch(()=>{});}
 p.close();
}
