import fs from 'node:fs';
let api=fs.readFileSync('mobile/src/api.ts','utf8');
api=api.replace("import * as SecureStore", "import {Platform} from 'react-native';\nimport * as SecureStore");
api=api.replace("const value=await SecureStore.getItemAsync('samadhan.connection');", "if(Platform.OS==='web')return {url:window.location.origin,token:''};const value=await SecureStore.getItemAsync('samadhan.connection');");
api=api.replaceAll('Authorization:`Bearer ${c.token}`','...(c.token?{Authorization:`Bearer ${c.token}`}:{})');
api=api.replace("form.append('file',{uri,type:mime,name:mime==='image/png'?'report.png':'report.jpg'} as any);", "if(Platform.OS==='web'){const blob=await (await fetch(uri)).blob();form.append('file',blob,'report.jpg');}else form.append('file',{uri,type:mime,name:mime==='image/png'?'report.png':'report.jpg'} as any);");
fs.writeFileSync('mobile/src/api.ts',api);
let app=fs.readFileSync('mobile/src/App.tsx','utf8');
app=app.replace('import React,',"import Onboarding from './Onboarding';\nimport {Ionicons} from '@expo/vector-icons';\nimport React,");
app=app.replace('const t=(en:string,hi:string)',"const [onboarded,setOnboarded]=useState(false);const [residentName,setResidentName]=useState('Demo Resident');\n const t=(en:string,hi:string)");
app=app.replace('if(!ready)return',"if(!onboarded)return <Onboarding hindi={hindi} setHindi={setHindi} onComplete={name=>{setResidentName(name);setOnboarded(true);}}/>;\n if(!ready)return");
app=app.replace('headers:{Authorization:`Bearer ${connection.token}`}','headers:connection.token?{Authorization:`Bearer ${connection.token}`}:{undefined:undefined}');
// Replace text glyphs with accessible, consistent native icons.
app=app.replace("[['home','⌂',", "[['home','home-outline',").replace("['complaints','▤',", "['complaints','document-text-outline',").replace("['notices','◉',", "['notices','notifications-outline',");
app=app.replace('<Text style={{fontSize:22,color:page===key?\'#08734f\':\'#8aa1a7\'}}>{icon}</Text>', '<Ionicons name={icon as any} size={22} color={page===key?\'#08734f\':\'#8aa1a7\'}/>');
fs.writeFileSync('mobile/src/App.tsx',app);
