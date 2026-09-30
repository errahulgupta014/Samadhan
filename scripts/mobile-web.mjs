import {cpSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Keep one domain model while giving Expo a self-contained app directory.
cpSync('shared','mobile/shared',{recursive:true});
const result=spawnSync(process.execPath,['node_modules/expo/bin/cli','export','--platform','web'],{cwd:'mobile',stdio:'inherit',env:{...process.env,CI:'1'}});
if(result.status!==0)process.exit(result.status||1);
mkdirSync('public/mobile-app',{recursive:true});cpSync('mobile/dist','public/mobile-app',{recursive:true});
cpSync('mobile/dist/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts','public/mobile-app/fonts',{recursive:true});
const bundleDir='public/mobile-app/_expo/static/js/web';
for(const file of readdirSync(bundleDir)){if(!file.endsWith('.js'))continue;const filePath=bundleDir+'/'+file;writeFileSync(filePath,readFileSync(filePath,'utf8').replaceAll('assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/','fonts/'));}
const path='public/mobile-app/index.html';let html=readFileSync(path,'utf8');html=html.replace('</head>','<style>html,body{background:#edf3f1!important}#root{max-width:460px;margin:0 auto;background:white;box-shadow:0 0 70px #1e574310;height:100dvh}</style></head>');writeFileSync(path,html);
console.log('Citizen native app web preview: /mobile-app/index.html');
