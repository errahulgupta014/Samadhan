import fs from 'node:fs';
function edit(file,fn){fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')));}
edit('shared/access.ts',s=>s.replace("{transition:","{'add-demo-content':'settings.manage',transition:"));
edit('tests/community.test.mjs',s=>s.replace("'lib/community-service'","'lib/community-service','lib/demo-community'"));
edit('tests/workflow.test.mjs',s=>s.replace("const code=await applyAction(s,{action:'issue-closure-code',id:c.id},'resident',100001);","const code=await applyAction(s,{action:'preview-closure-code',id:c.id},'resident',100001);")
 .replace("const code=await applyAction(s,{action:'issue-closure-code',id:c.id},'resident',100000);","await applyAction(s,{action:'issue-closure-code',id:c.id},'resident',100000);const code=await applyAction(s,{action:'preview-closure-code',id:c.id},'resident',100000);")
 .replace('s.audit.length,5','s.audit.length,5'));
edit('tests/api-smoke.mjs',s=>s.replace("action:'issue-closure-code',id},token)).j.demoCode","action:'preview-closure-code',id},token)).j.demoCode"));
edit('mobile/src/api.ts',s=>s.replace('{status:response.status}', '{status:response.status,data:result.data,version:result.version}'));
edit('mobile/src/App.tsx',s=>s.replace("catch(e){if((e as {status?:number}).status===409)","catch(e){const failure=e as {data?:Workspace;version?:number;status?:number};if(failure.data&&failure.version){setData(failure.data);setVersion(failure.version);}if(failure.status===409)")
 .replace("const r=await act({action:'issue-closure-code',id:c.id});setDemoCode('');", "await act({action:'issue-closure-code',id:c.id});setDemoCode('');"));
edit('mobile/src/CommunityScreens.tsx',s=>s.replace("import {registerDeviceNotifications} from './notifications';",'')
 .replace(",[deviceBusy,setDeviceBusy]=useState(false)",'')
 .replace(/\{Platform.OS!=='web'&&<Action secondary disabled=\{busy\|\|deviceBusy[\s\S]*?\/>\}/,'')
 .replace('Receive new admin-published ads in your inbox.','Receive ads in your inbox. WhatsApp alerts will activate after provider setup.')
 .replace('प्रशासन द्वारा प्रकाशित नए विज्ञापन इनबॉक्स में प्राप्त करें।','नए विज्ञापन इनबॉक्स में प्राप्त करें। सेवा जुड़ने पर WhatsApp सूचनाएं मिलेंगी।'));
