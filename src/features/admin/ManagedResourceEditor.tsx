import {useEffect,useId,useRef,useState} from 'react';
import {httpsCallable} from 'firebase/functions';
import {Pencil} from 'lucide-react';
import {getFirebaseServices} from '../../lib/firebase/client';
import type {ManagedResourceType} from './ArchiveResourceManagement';
import styles from './ActionDialog.module.css';
type Editable={title:string;body:string;format:'plain'|'markdown';source:string;plainOnly:boolean;revision:string};
export function ManagedResourceEditor({id,type,title,onSaved}:{id:string;type:ManagedResourceType;title:string;onSaved:()=>void}){
 const [open,setOpen]=useState(false),[value,setValue]=useState<Editable|null>(null),[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0),heading=useId();
 useEffect(()=>{if(!open)return;const element=dialog.current,opener=document.activeElement instanceof HTMLElement?document.activeElement:null;element?.showModal();return()=>{element?.close();opener?.focus()}},[open]);
 const close=()=>{if(saving)return;generation.current++;setOpen(false)};
 const load=async()=>{const request=++generation.current;setOpen(true);setValue(null);setReason('');setError('');try{const services=getFirebaseServices();if(!services)throw Error();const result=await httpsCallable<{targetType:ManagedResourceType;targetId:string},Editable>(services.functions,'getManagedArchiveResource')({targetType:type,targetId:id});if(request===generation.current)setValue(result.data)}catch{if(request===generation.current)setError('수정할 내용을 불러오지 못했어요. 닫고 다시 시도해 주세요.')}};
 const save=async()=>{if(!value||saving)return;if(!value.title.trim()||reason.trim().length<2){setError('제목과 수정 사유를 입력해 주세요.');return}setSaving(true);setError('');try{const services=getFirebaseServices();if(!services)throw Error();await httpsCallable(services.functions,'updateManagedArchiveResource')({targetType:type,targetId:id,...value,reason:reason.trim()});setOpen(false);onSaved()}catch(e){const code=e&&typeof e==='object'&&'code'in e?e.code:'';setError(code==='functions/aborted'?'다른 수정이 먼저 저장됐어요. 닫고 다시 열어 최신 내용을 확인해 주세요.':'저장하지 못했어요. 본문과 수정 사유를 확인해 주세요.')}finally{setSaving(false)}};
 return <><button className="button button-secondary" type="button" aria-label={`${title} 관리자 수정`} onClick={()=>void load()}><Pencil size={16}/>수정</button>{open&&<dialog ref={dialog} className={`${styles.dialog} ${styles.editor}`} aria-labelledby={heading} onCancel={event=>{event.preventDefault();close()}}><h2 id={heading}>자료 수정</h2>{!value&&!error&&<p role="status">내용을 불러오는 중이에요</p>}{value&&<div className={styles.editFields}>
  <label className={styles.field}>제목<input value={value.title} maxLength={160} disabled={saving} onChange={e=>setValue({...value,title:e.target.value})}/></label>
  <label className={styles.field}>{value.plainOnly?'설명':'본문'}<textarea rows={10} value={value.body} maxLength={value.plainOnly?5000:50000} disabled={saving} onChange={e=>setValue({...value,body:e.target.value})}/></label>
  {!value.plainOnly&&<label className={styles.field}>글 표시 방식<select value={value.format} disabled={saving} onChange={e=>setValue({...value,format:e.target.value as Editable['format']})}><option value="plain">입력한 모양 유지</option><option value="markdown">제목·목록으로 정리</option></select></label>}
  {type!=='collection'&&<label className={styles.field}>출처<input value={value.source} maxLength={500} disabled={saving} onChange={e=>setValue({...value,source:e.target.value})}/></label>}
  <label className={styles.field}>수정 사유<input value={reason} maxLength={300} disabled={saving} placeholder="예: 회의 날짜와 본문 오탈자 수정" onChange={e=>setReason(e.target.value)}/></label>
 </div>}{error&&<p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button className="button button-secondary" type="button" disabled={saving} onClick={close}>취소</button><button className="button button-primary" type="button" disabled={saving||!value} onClick={()=>void save()}>{saving?'저장 중':'수정 저장'}</button></div></dialog>}</>
}
