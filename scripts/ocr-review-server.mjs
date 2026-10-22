// Review server: allow only this checkout and its shared dependency directory.
import {createServer} from '../glint/node_modules/vite/dist/node/index.js';
import {realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../glint');
const server=await createServer({root,configFile:join(root,'vite.config.ts'),server:{port:5175,strictPort:true,fs:{allow:[root,realpathSync(join(root,'node_modules'))]}}});
await server.listen();server.printUrls();
