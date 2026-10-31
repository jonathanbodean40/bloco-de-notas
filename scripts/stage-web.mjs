import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(), dest=path.join(root,'www');
const staticExtensions=new Set(['.html','.js','.css','.json','.webmanifest','.svg','.png','.jpg','.jpeg','.webp','.gif','.woff','.woff2','.wasm','.dic','.aff']);
const excluded=new Set(['node_modules','www','desktop','scripts','android','dist-installers','.git','.github','.runtime']);
fs.rmSync(dest,{recursive:true,force:true});
fs.mkdirSync(dest,{recursive:true});
for (const entry of fs.readdirSync(root,{withFileTypes:true})) {
 if(excluded.has(entry.name)||entry.name.startsWith('.'))continue;
 const source=path.join(root,entry.name), target=path.join(dest,entry.name);
 if(entry.isDirectory()) {
   if(['vendor','assets','icons','fonts','dictionaries'].includes(entry.name))fs.cpSync(source,target,{recursive:true});
 } else if(staticExtensions.has(path.extname(entry.name).toLowerCase()) && !['package.json','package-lock.json','capacitor.config.json'].includes(entry.name))fs.copyFileSync(source,target);
}
if(!fs.existsSync(path.join(dest,'index.html'))||!fs.existsSync(path.join(dest,'private-access.js'))||!fs.existsSync(path.join(dest,'app.js')))throw Error('Faltam ficheiros essenciais; packaging interrompido.');
console.log('Pacote web local preparado: '+dest);
