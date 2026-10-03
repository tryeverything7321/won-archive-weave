import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { getFirebaseServices } from '../../lib/firebase/client';
export function CalendarDeleteAction({eventId}:{eventId:string}) {
 const navigate=useNavigate();
 const [access,setAccess]=useState({canDelete:false,requiresReason:false});
 const [confirming,setConfirming]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const services=getFirebaseServices();if(!services)return;let generation=0;const stop=onAuthStateChanged(services.auth,user=>{const request=++generation;setAccess({canDelete:false,requiresReason:false});if(user)void httpsCallable<{eventId:string},{canDelete:boolean;requiresReason:boolean}>(services.functions,'getCalendarEventManagement')({eventId}).then(({data})=>{if(generation===request)setAccess(data);}).catch(()=>{});});return()=>{++generation;stop();};},[eventId]);
 if(!access.canDelete)return null;
 const remove=async()=>{const services=getFirebaseServices();if(!services||busy)return;setBusy(true);setError('');try{await httpsCallable(services.functions,'deleteCalendarEvent')({eventId,reason});navigate('/calendar',{replace:true});}catch{setError('삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');setBusy(false);}};
 return <section className="owned-content-actions" aria-label="행사 삭제">
 {!confirming?<button type="button" className="button button-secondary" onClick={()=>setConfirming(true)}><Trash2 size={16} aria-hidden="true"/>행사 삭제</button>:<div className="calendar-delete-confirm">
 <h2>이 행사를 위브 일정에서 삭제할까요?</h2><p>외부 캘린더의 원본은 유지됩니다. 위브의 삭제 이력은 보관됩니다.</p>
 {access.requiresReason&&<label>삭제 사유<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} minLength={2} disabled={busy}/></label>}
 <div><button type="button" className="button button-secondary" disabled={busy} onClick={()=>setConfirming(false)}>취소</button><button type="button" className="button button-primary" disabled={busy||(access.requiresReason&&reason.trim().length<2)} onClick={()=>void remove()}>{busy?'삭제 중':'행사 삭제'}</button></div>
 {error&&<p role="alert">{error}</p>}</div>}
 </section>;
}
