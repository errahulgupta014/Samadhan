// Regenerates the home-screen icons used by the installable web app (written to mobile/assets/pwa/). Run: node scripts/make-pwa-icons.mjs
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
const PAPER={r:255,g:254,b:250,alpha:1};
const src='mobile/assets/samadhan-logo.png';
mkdirSync('mobile/assets/pwa',{recursive:true});
// logo on the app's paper background; `fill` is the share of the icon the logo covers (maskable icons keep a safe zone for round masks)
async function icon(file,size,fill){
 const inner=Math.round(size*fill);
 const logo=await sharp(src).resize(inner,inner,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).toBuffer();
 await sharp({create:{width:size,height:size,channels:4,background:PAPER}}).composite([{input:logo,gravity:'centre'}]).png().toFile('mobile/assets/pwa/'+file);
 console.log(file,size+'x'+size);
}
await icon('icon-192.png',192,0.88);
await icon('icon-512.png',512,0.88);
await icon('icon-maskable-512.png',512,0.66);
await icon('apple-touch-icon.png',180,0.9);
