import {cpSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {spawnSync} from 'node:child_process';
// Keep one domain model while giving Expo a self-contained app directory.
cpSync('shared','mobile/shared',{recursive:true});
const result=spawnSync(process.execPath,['node_modules/expo/bin/cli','export','--platform','web'],{cwd:'mobile',stdio:'inherit',env:{...process.env,CI:'1'}});
if(result.status!==0)process.exit(result.status||1);
const generated=resolve('public/app');
if(relative(process.cwd(),generated)!==join('public','app'))throw new Error('Unexpected mobile export destination.');
// This directory contains generated output only; discard stale bundles and unused font files.
rmSync(generated,{recursive:true,force:true});
mkdirSync(generated,{recursive:true});cpSync('mobile/dist',generated,{recursive:true});
// Installable web app (home-screen install on Android and iPhone): icons, manifest and a minimal service worker. Regenerate icons with scripts/make-pwa-icons.mjs.
cpSync('mobile/assets/pwa','public/app/pwa',{recursive:true});
writeFileSync('public/app/manifest.webmanifest',JSON.stringify({name:'SAMADHAN',short_name:'SAMADHAN',description:'Report civic problems in your ward and follow their progress.',lang:'en-IN',start_url:'/app/',scope:'/app/',id:'/app/',display:'standalone',orientation:'portrait',background_color:'#FFFEFA',theme_color:'#193753',icons:[{src:'/app/pwa/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/app/pwa/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/app/pwa/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]},null,2));
// No caching on purpose: the app must always show what the administrators published. The worker exists so browsers treat the app as installable.
writeFileSync('public/app/sw.js',["self.addEventListener('install',()=>self.skipWaiting());","self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));","self.addEventListener('fetch',()=>{});",""].join(String.fromCharCode(10)));

cpSync('mobile/dist/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts','public/app/fonts',{recursive:true});
// Vite can ignore files beneath public/**/node_modules when they arrive after startup.
// Keep the exported font hashes but serve both icon and text fonts from a normal public directory.
const poppinsDir='assets/node_modules/@expo-google-fonts/poppins/';
const fontRewrites=[];
for(const weight of readdirSync('mobile/dist/'+poppinsDir)){
 for(const font of readdirSync('mobile/dist/'+poppinsDir+weight)){
  if(!font.endsWith('.ttf'))continue;
  cpSync('mobile/dist/'+poppinsDir+weight+'/'+font,'public/app/fonts/'+font);
  fontRewrites.push([poppinsDir+weight+'/'+font,'fonts/'+font]);
 }
}
const bundleDir='public/app/_expo/static/js/web';
for(const file of readdirSync(bundleDir)){if(!file.endsWith('.js'))continue;const filePath=bundleDir+'/'+file;let code=readFileSync(filePath,'utf8').replaceAll('assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/','fonts/');for(const [from,to] of fontRewrites)code=code.replaceAll(from,to);writeFileSync(filePath,code);}
// Inline CSS splash: painted as soon as index.html arrives (before the JS bundle has downloaded) and replaced when React mounts
// (react-native-web clears #root's children on its first render). It mirrors the first frame of BrandedSplash in
// mobile/src/Brand.tsx - logo centred at SPLASH_LOGO_SIZE (160px) on SPLASH_BG (#FFFEFA) - and only adds fade/pulse keyframes.
const path='public/app/index.html';let html=readFileSync(path,'utf8');
const inject=(needle,markup)=>{if(!html.includes(needle))throw new Error(`Expected ${needle} in ${path}; the Expo web template changed.`);html=html.replace(needle,()=>markup);};
const splashLogo=readFileSync('mobile/assets/splash-logo-web.png').toString('base64');
const splashCss='#samadhan-splash{position:relative;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#FFFEFA}'
 +'#samadhan-splash img{width:160px;height:160px;display:block}'
 +'#samadhan-splash .ss-band{position:absolute;left:0;right:0;height:5px;opacity:0;background:linear-gradient(90deg,#FF9933 0,#FF9933 33.33%,#FFFFFF 33.33%,#FFFFFF 66.66%,#138808 66.66%,#138808 100%);animation:ss-in .6s .12s ease-out forwards,ss-pulse 2.4s 1s ease-in-out infinite}'
 +'#samadhan-splash .ss-top{top:0}#samadhan-splash .ss-bottom{bottom:0}'
 +'#samadhan-splash .ss-slow{position:absolute;left:0;right:0;bottom:32px;margin:0;text-align:center;font:12px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#677489;opacity:0;visibility:hidden;pointer-events:none;animation:ss-slow .6s 12s ease-out forwards}'
 +'#samadhan-splash .ss-slow a{color:#193753}'
 +'@keyframes ss-in{to{opacity:1}}@keyframes ss-pulse{0%,100%{opacity:1}50%{opacity:.55}}@keyframes ss-slow{from{opacity:0;visibility:hidden;pointer-events:none}to{opacity:1;visibility:visible;pointer-events:auto}}';
const splashHtml=`<div id="samadhan-splash" role="status" aria-label="Loading SAMADHAN"><i class="ss-band ss-top"></i><img src="data:image/png;base64,${splashLogo}" width="160" height="160" alt="SAMADHAN" fetchpriority="high" decoding="sync"><i class="ss-band ss-bottom"></i><p class="ss-slow">Still loading… <a href="">Reload</a></p></div>`;
// React's own logo is the same artwork; preload it so it is already decoded when the inline splash is swapped out.
let logoAsset;try{logoAsset=readdirSync('public/app/assets/assets').find(file=>/^splash-logo\.[0-9a-f]+\.png$/.test(file));}catch{}
inject('</head>',`${logoAsset?`<link rel="preload" as="image" href="/app/assets/assets/${logoAsset}">`:''}<style>html,body{background:#edf3f1!important}#root{max-width:460px;margin:0 auto;background:white;box-shadow:0 0 70px #1e574310;height:100dvh}${splashCss}</style></head>`);
inject('</head>','<link rel="manifest" href="/app/manifest.webmanifest"><meta name="theme-color" content="#193753"><meta name="application-name" content="SAMADHAN"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="SAMADHAN"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="apple-touch-icon" href="/app/pwa/apple-touch-icon.png"><link rel="icon" type="image/png" sizes="192x192" href="/app/pwa/icon-192.png"><script>if("serviceWorker"in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("/app/sw.js",{scope:"/app/"}).catch(function(){})})</script></head>');
inject('<div id="root"></div>',`<div id="root">${splashHtml}</div>`);
writeFileSync(path,html);
console.log('Citizen app web build: /app/index.html');
