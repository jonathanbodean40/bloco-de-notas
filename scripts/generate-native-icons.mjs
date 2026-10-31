import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root=process.cwd();
const svg=await fs.readFile(path.join(root,'icon.svg'));
const desktop=path.join(root,'desktop','assets');
await fs.mkdir(desktop,{recursive:true});
const desktopSizes=[16,24,32,48,64,128,256];
const buffers=await Promise.all(desktopSizes.map(size=>sharp(svg).resize(size,size).png().toBuffer()));
await fs.writeFile(path.join(desktop,'icon.ico'),await pngToIco(buffers));
await fs.writeFile(path.join(desktop,'icon.png'),await sharp(svg).resize(512,512).png().toBuffer());
const variants={mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};
for(const [density,size] of Object.entries(variants)){
 const folder=path.join(root,'android','app','src','main','res','mipmap-'+density);
 await fs.mkdir(folder,{recursive:true});
 for(const name of ['ic_launcher.png','ic_launcher_round.png']){
   await fs.writeFile(path.join(folder,name),await sharp(svg).resize(size,size).png().toBuffer());
 }
 await fs.writeFile(path.join(folder,'ic_launcher_foreground.png'),await sharp(svg).resize(size*2,size*2).png().toBuffer());
}
console.log('Branded Windows and Android icon assets created');
