'use client';
import {Children,type FormEvent,type ReactNode} from 'react';
import {Eye,Pencil,Trash2,LoaderCircle} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useFocusReturn} from './form-bits';
import './content-tables.css'; // the shared filter toolbar (FilterToolbar in form-bits.tsx) is styled there
import './record-tables.css';

/**
 * Pieces shared by the admin record tables (Departments, Admin Users, App users, Categories, Wards, Banners):
 * every row offers View, Edit, Active/Inactive and Delete; viewing, adding and editing happen in a popup with a scrollable body and a sticky footer.
 * Styles live in record-tables.css.
 */

/** Status chip with its text ("Active", "Inactive", "Blocked"...). Colour is never the only signal. */
export function StatusChip({tone='off',children}:{tone?:'on'|'off'|'bad'|'warn'|'info';children:ReactNode}){return <span className={`rt-chip ${tone}`}>{children}</span>;}

/** One toggle for the whole row: the visible text says the current state. Used for the Active/Inactive action. */
export function StatusSwitch({on,onLabel='Active',offLabel='Inactive',name,onToggle,disabled,reason}:{on:boolean;onLabel?:string;offLabel?:string;name:string;onToggle:()=>void;disabled?:boolean;reason?:string}){
 const text=on?onLabel:offLabel;
 return <button type="button" role="switch" aria-checked={on} className="rt-switch" disabled={disabled} title={reason} aria-label={`${text}: ${name}${disabled&&reason?`. ${reason}`:''}`} onClick={onToggle}><span className="rt-track" aria-hidden="true"/>{text}</button>;
}

export type RowToggle={on:boolean;onLabel?:string;offLabel?:string;onChange:()=>void;disabled?:boolean;reason?:string};
export type RowAction={onClick:()=>void;disabled?:boolean;reason?:string};
/** `unavailable` keeps the Delete button in place but explains (on click and as a tooltip) why the record cannot be deleted. */
export type RowDelete=RowAction&{unavailable?:boolean};

/**
 * The four row actions, always in this order: View, Edit, Active/Inactive, Delete.
 * Leave `edit`, `toggle` and `del` out for people who may only read: they get View alone. `busy` (a save is running) disables everything except View.
 * Pass `del` only to a Super Admin (useIsSuperAdmin in form-bits.tsx): nobody else may delete, so their rows get no Delete button at all, not a disabled one.
 */
export function RowActions({name,onView,edit,toggle,del,busy}:{name:string;onView:()=>void;edit?:RowAction;toggle?:RowToggle;del?:RowDelete;busy?:boolean}){
 return <div className="rt-actions" role="group" aria-label={`Actions for ${name}`}>
  <button type="button" className="rt-btn" onClick={onView} aria-label={`View ${name}`} title="View"><Eye size={15} aria-hidden="true"/><span className="rt-label">View</span></button>
  {edit&&<button type="button" className="rt-btn" onClick={edit.onClick} disabled={edit.disabled||busy} aria-label={`Edit ${name}${edit.disabled&&edit.reason?`. ${edit.reason}`:''}`} title={edit.reason??'Edit'}><Pencil size={15} aria-hidden="true"/><span className="rt-label">Edit</span></button>}
  {toggle&&<StatusSwitch name={name} on={toggle.on} onLabel={toggle.onLabel} offLabel={toggle.offLabel} onToggle={toggle.onChange} disabled={toggle.disabled||busy} reason={toggle.reason}/>}
  {del&&<button type="button" className="rt-btn danger" onClick={del.onClick} disabled={(del.disabled&&!del.unavailable)||busy} aria-disabled={del.unavailable||undefined} aria-label={`Delete ${name}${(del.disabled||del.unavailable)&&del.reason?`. ${del.reason}`:''}`} title={del.reason??'Delete'}><Trash2 size={15} aria-hidden="true"/><span className="rt-label">Delete</span></button>}
 </div>;
}

/** The popup shell: title, description and a close button; `children` are <DialogBody> and <DialogFoot> (or a <DialogForm> holding both). Closing is blocked while `locked` (a save is running). */
export function RecordDialog({open,onClose,title,description,wide,locked,children}:{open:boolean;onClose:()=>void;title:ReactNode;description?:ReactNode;wide?:boolean;locked?:boolean;children?:ReactNode}){
 const returnFocus=useFocusReturn(open);// the popup opens from an ordinary button, so focus goes back to it (or the page heading when its row is gone)
 return <Dialog open={open} onOpenChange={v=>{if(!v&&!locked)onClose();}}><DialogContent className={`rt-dialog${wide?' rt-wide':''}`} onCloseAutoFocus={returnFocus}>
  <DialogHeader className="rt-dialog-head"><DialogTitle>{title}</DialogTitle><DialogDescription className={description?undefined:'sr-only'}>{description??'Details'}</DialogDescription></DialogHeader>
  {children}
 </DialogContent></Dialog>;
}
export function DialogBody({children}:{children?:ReactNode}){return <div className="rt-dialog-body">{children}</div>;}
export function DialogFoot({children}:{children?:ReactNode}){return <div className="rt-dialog-foot">{children}</div>;}
/** A form that wraps the scrolling body and the sticky footer, so the submit button stays visible. */
export function DialogForm({onSubmit,children,noValidate}:{onSubmit:(e:FormEvent<HTMLFormElement>)=>void;children?:ReactNode;noValidate?:boolean}){return <form className="rt-dialog-main" onSubmit={onSubmit} noValidate={noValidate}>{children}</form>;}
export function Busy({working,label,children}:{working?:boolean;label:string;children:ReactNode}){return working?<><LoaderCircle className="spin" size={16} aria-hidden="true"/> {label}</>:<>{children}</>;}
export function FormError({children}:{children?:ReactNode}){return children?<p className="rt-error" role="alert">{children}</p>:null;}

/** Plain-English confirmation for Block, Unblock, Disable and Restore. The confirm button is the only way through; Escape, the overlay and Cancel keep things as they were. Deleting a record uses ConfirmDelete in form-bits.tsx instead. */
export function ConfirmDialog({open,title,description,children,confirmLabel,workingLabel,tone='danger',busy,error,onConfirm,onCancel}:{open:boolean;title:ReactNode;description:ReactNode;children?:ReactNode;confirmLabel:string;workingLabel?:string;tone?:'danger'|'primary';busy?:boolean;error?:string;onConfirm:()=>void;onCancel:()=>void}){
 return <RecordDialog open={open} onClose={onCancel} locked={busy} title={title} description={description}>
  {(error||Children.count(children)>0)&&<DialogBody>{children}<FormError>{error}</FormError></DialogBody>}
  <DialogFoot><button type="button" className="button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className={`button ${tone==='danger'?'rt-danger':'primary'}`} disabled={busy} onClick={onConfirm}><Busy working={busy} label={workingLabel??'Working…'}>{confirmLabel}</Busy></button></DialogFoot>
 </RecordDialog>;
}

/** Every field of a record as label/value pairs, no inputs: the body of a View popup. Empty values read "Not set". */
export function ViewFields({items}:{items:{label:string;value:ReactNode}[]}){
 return <dl className="rt-facts">{items.map(i=><div className="rt-fact" key={i.label}><dt>{i.label}</dt><dd>{i.value===undefined||i.value===null||i.value===''||i.value===false?<span className="rt-muted">Not set</span>:i.value}</dd></div>)}</dl>;
}

/** Dates for tables and View popups. */
export const dateOf=(iso?:string|null)=>{const d=new Date(iso??'');return Number.isFinite(+d)?d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'';};
export const dateTimeOf=(iso?:string|null)=>{const d=new Date(iso??'');return Number.isFinite(+d)?d.toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):'';};
export const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
