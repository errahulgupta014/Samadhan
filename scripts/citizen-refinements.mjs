import fs from 'node:fs';
function edit(file,fn){fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')));}
edit('mobile/src/App.tsx',s=>s.replace("import HomeScreen", "import BackHome from './BackHome';\nimport HomeScreen")
 .replace("const setPage=(screen:string)=>router.setParams({section:screen});", "const navigationHistory=useRef<string[]>([]);const setPage=(screen:string)=>{if(screen===page)return;if(screen==='home')navigationHistory.current=[];else navigationHistory.current.push(page);router.setParams({section:screen});};const goBack=()=>{const previous=navigationHistory.current.pop()??'home';router.setParams({section:previous});setError('');};")
 .replace("onClose={()=>setPage('profile')}","onClose={goBack}")
 .replace("{page!=='home'&&<Button secondary title=\"← Home\" onPress={()=>setPage('home')}/>}","{page!=='home'&&page!=='report'&&<BackHome back={goBack} home={()=>setPage('home')} hindi={hindi}/>}")
 .replace('<ReportFlow connection=',"<ReportFlow back={goBack} home={()=>setPage('home')} connection=")
 .replace("setSelected(id);setPage('detail');","setSelected(id);navigationHistory.current=navigationHistory.current.filter(p=>p!=='report');router.setParams({section:'detail'});")
 .replace('Inspect the work and confirm with a test code.','The admin has requested closure. Inspect the work before confirming. WhatsApp delivery is pending setup; use the test preview below.')
 .replace('<Button busy={busy} title="Get test verification code"', '<Button busy={busy} title="Preview WhatsApp OTP (test only)" onPress={()=>void perform(async()=>{const r=await act({action:\'preview-closure-code\',id:c.id});setDemoCode(r.demoCode);})}/><Button secondary busy={busy} title="Request another WhatsApp OTP"')
 .replace("setDemoCode(r.demoCode);})}/>{!!demoCode", "setDemoCode('');})}/>{!!demoCode")
 .replace('Simulated delivery: {demoCode}', 'WhatsApp preview only — not sent: {demoCode}')
 .replace('<Text style={s.caption}>{c.id}</Text><Text style={s.h1}>','<Text style={s.caption}>REFERENCE NUMBER</Text><Text selectable style={[s.label,{fontWeight:\'700\'}]}>{c.id}</Text><Text style={s.h1}>'));
edit('mobile/src/ReportFlow.tsx',s=>s.replace("import React", "import BackHome from './BackHome';\nimport React")
 .replace('{connection,hindi,act,onSuccess}:{connection:Connection;', '{connection,hindi,act,onSuccess,back,home}:{back:()=>void;home:()=>void;connection:Connection;')
 .replace('if(success)return <View style={s.success}>','if(success)return <><BackHome back={()=>onSuccess(success)} home={home} hindi={hindi}/><View style={s.success}>')
 .replace("t('COMPLAINT NUMBER','शिकायत संख्या')", "t('YOUR REFERENCE NUMBER','आपकी शिकायत संख्या')")
 .replace('<Text style={s.small}>Test mode · no WhatsApp or SMS has been sent</Text></View>;', '<Text style={s.small}>{t(\'Save this reference to track your complaint. WhatsApp acknowledgement is pending provider setup; no message has been sent.\',\'शिकायत की स्थिति देखने के लिए यह संख्या सुरक्षित रखें। WhatsApp सेवा अभी जुड़ी नहीं है; संदेश नहीं भेजा गया है।\')}</Text></View></>;')
 .replace('return <View>', 'return <View><BackHome back={()=>step>0?setStep(step-1):back()} home={home} hindi={hindi} disabled={busy}/>')
 .replace('setSuccess(r.id);','setSuccess(r.referenceNumber??r.id);'));
edit('mobile/src/Onboarding.tsx',s=>s.replace('Your mobile number keeps you connected to your complaint updates.','Your WhatsApp number receives OTPs, complaint references and status updates.')
 .replace('शिकायत की जानकारी आपके मोबाइल नंबर पर मिलेगी।','OTP, शिकायत संख्या और अपडेट केवल WhatsApp पर मिलेंगे।')
 .replace("t('Mobile number','मोबाइल नंबर')", "t('WhatsApp mobile number','WhatsApp मोबाइल नंबर')")
 .replace('Preview mode uses a sample number. No SMS is sent and this screen does not authenticate a real resident.','WhatsApp setup is pending. This preview uses a sample number and a simulated OTP; no message is sent and no real resident is authenticated.')
 .replace('यह नमूना नंबर है। इस पूर्वावलोकन में SMS नहीं भेजा जाता और वास्तविक लॉगिन नहीं होता।','WhatsApp सेवा अभी जुड़ी नहीं है। यहां नमूना नंबर और परीक्षण OTP है; संदेश नहीं भेजा जाता और वास्तविक लॉगिन नहीं होता।')
 .replace("t('Send test OTP','परीक्षण OTP भेजें')","t('Preview WhatsApp OTP','WhatsApp OTP का परीक्षण करें')")
 .replace("t('Simulated OTP','परीक्षण OTP')","t('WhatsApp OTP preview · not sent','WhatsApp परीक्षण OTP · भेजा नहीं गया')"));
edit('app/admin-panels.tsx',s=>s.replace("'Propose resolution'","'Request closure · WhatsApp OTP'")
 .replace('Waiting for resident verification. Open the citizen experience to test acceptance or dispute.','Closure requested. The complaint stays open until the resident verifies the OTP. WhatsApp delivery is pending setup; the resident can preview the test code in the app.')
 .replace('WhatsApp preferred · SMS fallback · Provider connection pending','WhatsApp only · Provider connection pending')
 .replace("['Complaint','Template','Channel','Recipient','Delivery']","['Complaint','Template','Message','Channel','Recipient','Delivery']")
 .replace('c.complaintId,c.template,c.channel,c.recipient,c.status','c.complaintId,c.template,c.message||c.reason,c.channel,c.recipient,c.status'));
