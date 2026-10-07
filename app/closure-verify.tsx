'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {LoaderCircle,MessageCircle,ShieldCheck} from 'lucide-react';

/**
 * Closing a complaint in the admin portal: when closure is requested the resident receives a one-time code on WhatsApp.
 * The resident gives that code to the officer, the officer enters it here and the complaint is resolved.
 * (Server actions: admin-verify-closure / admin-issue-closure-code; errors are shown by the parent.)
 */
export default function ClosureVerify({mobile,busy,readOnly=false,onVerify,onResend}:{mobile:string;busy:boolean;readOnly?:boolean;onVerify:(code:string)=>Promise<void>;onResend:()=>Promise<void>}){
 const [code,setCode]=useState('');const [cooldown,setCooldown]=useState(0);const [sent,setSent]=useState(false);
 useEffect(()=>{if(cooldown<=0)return;const timer=window.setTimeout(()=>setCooldown(n=>n-1),1000);return()=>window.clearTimeout(timer);},[cooldown]);
 const ending=mobile.replace(/[^0-9]/g,'').slice(-4);
 const target=ending?`the resident’s WhatsApp number ending ${ending}`:'the resident’s WhatsApp number';
 if(readOnly)return <p className="info-note">Closure requested. The complaint closes when the resident’s closure OTP is verified by an officer who can manage complaints.</p>;
 const valid=/^[0-9]{4,8}$/.test(code);
 async function submit(e:FormEvent){e.preventDefault();if(!valid||busy)return;await onVerify(code);setCode('');}
 async function resend(){await onResend();setSent(true);setCooldown(60);}
 return <form className="closure-verify" onSubmit={e=>void submit(e)} aria-label="Closure verification">
  <div className="closure-verify-head"><MessageCircle size={18} aria-hidden="true"/><b>Closure verification</b></div>
  <p>A closure OTP is sent to {target}. Ask the resident for the code, enter it below and the complaint will be resolved.</p>
  <label htmlFor="closure-otp">Closure OTP</label>
  <div className="closure-verify-row">
   <input id="closure-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,8}" maxLength={8} value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,''))} placeholder="Enter the OTP" aria-describedby="closure-otp-note"/>
   <button type="submit" className="button primary" disabled={!valid||busy}>{busy?<LoaderCircle className="spin" size={16}/>:<ShieldCheck size={16}/>}Verify OTP &amp; close complaint</button>
  </div>
  <div className="closure-verify-foot">
   <button type="button" className="text-button" disabled={busy||cooldown>0} onClick={()=>void resend()}>{cooldown>0?`Resend OTP in ${cooldown} s`:'Resend OTP'}</button>
   {sent&&cooldown>0&&<span role="status">A new OTP was sent.</span>}
  </div>
  <small id="closure-otp-note">The code expires after 5 minutes. After five wrong entries ask for a new OTP.</small>
 </form>;
}
