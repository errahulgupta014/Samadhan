'use client';
import {useState} from 'react';
import {resolveAppConfig,type AppConfig,type Workspace} from '@/shared/domain';
import {HindiHint} from './form-bits';

type Act=(body:Record<string,unknown>)=>Promise<any>;
const CONTROL=/[\u0000-\u001f\u007f]/;
const httpsOk=(v:string)=>{const raw=v.trim();if(!raw)return true;if(raw.length>1000||!/^https:\/\/[^/\\?#]/i.test(raw)||/[\s\u0000-\u001f\u007f\\]/u.test(raw))return false;try{const u=new URL(raw);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}};
/** Mirrors the server rules so mistakes are caught before sending; the server stays the authority and its message is shown if it disagrees. */
export function appConfigProblem(c:AppConfig):string{
 if(c.orgLabel.en.trim().length<2||c.orgLabel.hi.trim().length<2)return 'Enter the organisation name in English and Hindi.';
 if(c.support.phone.length>30||!/^[0-9+()\-.\s]*$/.test(c.support.phone))return 'Support phone: use digits, spaces, + - ( ) only, up to 30 characters.';
 if(c.support.email.trim()&&!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(c.support.email.trim()))return 'Support email: enter a valid email address.';
 if(!httpsOk(c.termsUrl))return 'Terms of use link must start with https:// and contain no spaces.';
 if(!httpsOk(c.privacyUrl))return 'Privacy policy link must start with https:// and contain no spaces.';
 if(c.minAppVersion.trim()&&!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(c.minAppVersion.trim()))return 'Minimum app version: use the form 1.2.3 or leave it empty.';
 if(c.maintenance.enabled&&c.maintenance.messageEn.trim().length<5)return 'Write the maintenance message residents should see before turning maintenance mode on.';
 if([c.support.hoursEn,c.support.hoursHi,c.maintenance.messageEn,c.maintenance.messageHi,c.support.phone,c.support.email,c.orgLabel.en,c.orgLabel.hi].some(v=>CONTROL.test(v)))return 'Remove line breaks and special characters from the text fields.';
 return '';
}
const clean=(c:AppConfig):AppConfig=>({...c,orgLabel:{en:c.orgLabel.en.trim(),hi:c.orgLabel.hi.trim()},support:{phone:c.support.phone.trim(),email:c.support.email.trim(),hoursEn:c.support.hoursEn.trim(),hoursHi:c.support.hoursHi.trim()},termsUrl:c.termsUrl.trim(),privacyUrl:c.privacyUrl.trim(),maintenance:{enabled:c.maintenance.enabled,messageEn:c.maintenance.messageEn.trim(),messageHi:c.maintenance.messageHi.trim()},minAppVersion:c.minAppVersion.trim()});

function Text({label,value,onChange,max,hint,type='text',hindi=false,area=false,placeholder,required=false}:{label:string;value:string;onChange:(v:string)=>void;max?:number;hint?:string;type?:string;hindi?:boolean;area?:boolean;placeholder?:string;required?:boolean}){
 return <label>{label}{area?<textarea rows={3} maxLength={max} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/>:<input type={type} required={required} maxLength={max} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/>}{hint&&<small className="muted">{hint}</small>}{hindi&&<HindiHint value={value}/>}</label>;
}
function Toggle({label,checked,onChange,hint}:{label:string;checked:boolean;onChange:(v:boolean)=>void;hint?:string}){
 return <label style={{flexDirection:'row',alignItems:'flex-start',gap:10,marginBottom:10}}><input type="checkbox" checked={checked} style={{width:'auto',marginTop:3}} onChange={e=>onChange(e.target.checked)}/><span>{label}{hint&&<small className="muted" style={{display:'block'}}>{hint}</small>}</span></label>;
}

/** Remote configuration of the citizen app (settings.appConfig) plus the ward and city names shown in the portal and the app. */
export default function AppSettingsManager({data,act,busy}:{data:Workspace;act:Act;busy:boolean}){
 const saved=resolveAppConfig(data.settings.appConfig);
 const [draft,setDraft]=useState<AppConfig>(saved),[error,setError]=useState(''),[message,setMessage]=useState('');
 const dirty=JSON.stringify(clean(draft))!==JSON.stringify(clean(saved));
 const patch=(fn:(c:AppConfig)=>AppConfig)=>{setDraft(fn);setMessage('');};
 async function save(){
  setError('');setMessage('');const issue=appConfigProblem(draft);if(issue){setError(issue);return;}
  try{const r=await act({action:'save-app-config',appConfig:clean(draft)});setDraft(resolveAppConfig(r?.data?.settings?.appConfig??clean(draft)));setMessage('App settings saved. Phones pick them up the next time the app opens or refreshes.');}catch(e){setError((e as Error).message);}
 }
 const h=(t:string)=><h3 style={{fontSize:14,margin:'22px 0 12px',color:'#183249'}}>{t}</h3>;
 return <section className="admin-section">
  <div className="section-title"><div><h2>App settings</h2><p>Controls what the citizen app shows and says. Changes reach phones when the app next opens or refreshes; no new app release is needed.</p></div></div>
  <form className="panel settings-card form-stack" onSubmit={e=>{e.preventDefault();void save();}}>
   <h2>Organisation and support</h2>
   <div className="two-fields"><Text label="Organisation name (English)" required max={100} value={draft.orgLabel.en} onChange={v=>patch(c=>({...c,orgLabel:{...c.orgLabel,en:v}}))} hint="Appears in the app wherever it says who runs the programmes, e.g. “Panchayat Samiti and Nagar Parishad”."/><Text label="Organisation name (हिन्दी)" required max={100} value={draft.orgLabel.hi} onChange={v=>patch(c=>({...c,orgLabel:{...c.orgLabel,hi:v}}))}/></div>
   {h('Need help? card')}
   <p className="muted" style={{marginTop:-6}}>Shown on the Home and Profile screens when any of these is filled in. Leave a field empty to hide it.</p>
   <div className="two-fields"><Text label="Support phone" type="tel" max={30} value={draft.support.phone} placeholder="e.g. 0141 2345678" onChange={v=>patch(c=>({...c,support:{...c.support,phone:v}}))} hint="Residents tap it to call."/><Text label="Support email" type="email" max={120} value={draft.support.email} onChange={v=>patch(c=>({...c,support:{...c.support,email:v}}))}/></div>
   <div className="two-fields"><Text label="Support hours (English)" max={200} value={draft.support.hoursEn} placeholder="e.g. Monday–Saturday, 10 AM–5 PM" onChange={v=>patch(c=>({...c,support:{...c.support,hoursEn:v}}))}/><Text label="Support hours (हिन्दी)" max={200} hindi value={draft.support.hoursHi} onChange={v=>patch(c=>({...c,support:{...c.support,hoursHi:v}}))}/></div>
   {h('Legal links')}
   <div className="two-fields"><Text label="Terms of use link (HTTPS)" type="url" max={1000} value={draft.termsUrl} placeholder="https://" onChange={v=>patch(c=>({...c,termsUrl:v}))}/><Text label="Privacy policy link (HTTPS)" type="url" max={1000} value={draft.privacyUrl} placeholder="https://" onChange={v=>patch(c=>({...c,privacyUrl:v}))}/></div>
   <p className="muted" style={{marginTop:-6}}>Shown as links on the Profile screen when set.</p>
   <h2 style={{marginTop:28}}>What the app shows</h2>
   <p className="muted" style={{marginTop:-6}}>Home, Complaints and Profile are always visible. Turn a section off to hide its tab and its Home tile.</p>
   <div className="two-fields"><div><h3 style={{fontSize:13,marginBottom:10}}>Bottom tabs</h3>
    <Toggle label="Ads tab" checked={draft.tabs.classifieds} onChange={v=>patch(c=>({...c,tabs:{...c.tabs,classifieds:v}}))}/><Toggle label="Activities tab" checked={draft.tabs.activities} onChange={v=>patch(c=>({...c,tabs:{...c.tabs,activities:v}}))}/><Toggle label="City tab" checked={draft.tabs.city} onChange={v=>patch(c=>({...c,tabs:{...c.tabs,city:v}}))}/></div>
   <div><h3 style={{fontSize:13,marginBottom:10}}>Home tiles</h3>
    <Toggle label="Ads tile" checked={draft.tiles.classifieds} onChange={v=>patch(c=>({...c,tiles:{...c.tiles,classifieds:v}}))}/><Toggle label="Activities tile" checked={draft.tiles.activities} onChange={v=>patch(c=>({...c,tiles:{...c.tiles,activities:v}}))}/><Toggle label="City tile" checked={draft.tiles.city} onChange={v=>patch(c=>({...c,tiles:{...c.tiles,city:v}}))}/><Toggle label="Ward updates tile" checked={draft.tiles.notices} onChange={v=>patch(c=>({...c,tiles:{...c.tiles,notices:v}}))}/></div></div>
   <h2 style={{marginTop:28}}>Maintenance and updates</h2>
   <Toggle label="Maintenance mode" checked={draft.maintenance.enabled} onChange={v=>patch(c=>({...c,maintenance:{...c.maintenance,enabled:v}}))} hint="Shows a banner at the top of the app with the message below. The app keeps working."/>
   <div className="two-fields"><Text label="Maintenance message (English)" area max={300} value={draft.maintenance.messageEn} placeholder="e.g. Complaint updates may be delayed tonight." onChange={v=>patch(c=>({...c,maintenance:{...c.maintenance,messageEn:v}}))}/><Text label="Maintenance message (हिन्दी)" area max={300} hindi value={draft.maintenance.messageHi} onChange={v=>patch(c=>({...c,maintenance:{...c.maintenance,messageHi:v}}))}/></div>
   <Text label="Minimum app version" max={20} value={draft.minAppVersion} placeholder="e.g. 1.2.0" onChange={v=>patch(c=>({...c,minAppVersion:v}))} hint="Phones running an older version are asked to update before they can use the app. Leave empty to allow every version."/>
   {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="info-note">{message}</p>}
   <div className="action-buttons"><button disabled={busy||!dirty} className="button primary">Save app settings</button>{dirty&&<button type="button" className="button" onClick={()=>{setDraft(saved);setError('');setMessage('');}}>Discard changes</button>}{dirty&&<span className="muted">Unsaved changes</span>}</div>
  </form>
 </section>;
}
