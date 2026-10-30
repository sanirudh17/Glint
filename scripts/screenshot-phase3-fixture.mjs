// Start with the synthetic video fixture made by studio-phase2-fixture.py.
import {readFile,writeFile,copyFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
if(!process.argv[2])throw Error('Pass the root printed by studio-phase2-fixture.py.');
const videoFixtureRoot=resolve(process.argv[2]),root=await mkdtemp(join(tmpdir(),'glint-phase3-'));
const png=await readFile(join(videoFixtureRoot,'source.png'));
const doc={annotations:[{id:'old-arrow',type:'arrow',z:0,style:{color:'#00cc88',strokeWidth:4,fontSize:24},x1:100,y1:300,x2:400,y2:300}],crop:null,frame:{enabled:true,background:{type:'gradient',gradientId:'dusk'},padding:40,radius:12,shadow:35,aspect:'auto',chrome:{style:'none',theme:'light',buttons:'mac',title:'',url:''}}};
await writeFile(join(root,'Legacy.glint'),JSON.stringify({glint:1,app:'0.1.14',image:{mime:'image/png',width:640,height:360,dataBase64:png.toString('base64')},doc}));
await copyFile(join(videoFixtureRoot,'source.png'),join(root,'source.png'));
await writeFile(join(root,'fixture.json'),JSON.stringify({root,videoFixtureRoot,project:join(root,'Legacy.glint'),source:join(root,'source.png')}));
console.log(JSON.stringify({root,videoFixtureRoot}));
