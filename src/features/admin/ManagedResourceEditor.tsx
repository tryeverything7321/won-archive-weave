import {useEffect,useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {httpsCallable} from 'firebase/functions';
import {ArrowLeft,Pencil,Save} from 'lucide-react';
import {getFirebaseServices} from '../../lib/firebase/client';
import {FieldRequirement} from '../../components/forms/FieldRequirement';
import {useOperatorAccess} from '../auth/useOperatorAccess';
import {TextComposer} from '../content/TextComposer';
import type {ManagedResourceType} from './ArchiveResourceManagement';
import styles from '../uploads/ContributionForm.module.css';
type Editable={title:string;body:string;format:'plain'|'markdown';source:string;plainOnly:boolean;revision:string};

export function ManagedResourceEditor({id,type,title}:{id:string;type:ManagedResourceType;title:string}){
 const location=useLocation();
 const query=new URLSearchParams({managedId:id,managedType:type,returnTo:location.pathname+location.search});
 return <Link className="button button-secondary" aria-label={`${title} 관리자 수정`} to={`/contribute?${query}`}><Pencil size={16}/>수정</Link>;
}

export function ManagedResourceEditForm(){
 const location=useLocation(),navigate=useNavigate(),access=useOperatorAccess();
 const query=new URLSearchParams(location.search),id=query.get('managedId')??'',type=query.get('managedType')??'';
 let returnTo='/resources';
 try{const destination=new URL(query.get('returnTo')||returnTo,window.location.origin);if(destination.origin===window.location.origin&&/^\/(resources|materials|activities|bundles|collections|admin)(\/|$)/.test(destination.pathname))returnTo=destination.pathname+destination.search}catch{/* Invalid return paths fall back to the resource list. */}
 const [value,setValue]=useState<Editable|null>(null),[initial,setInitial]=useState(''),[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const dirty=!!value&&JSON.stringify(value)!==initial;
 useEffect(()=>{
  if(!dirty)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);
 useEffect(()=>{
  let active=true;
  if(!access.administrator)return;
  if(!id||!['material','activity','submission','bundle','collection'].includes(type))return;
  const services=getFirebaseServices();if(!services)return;
  void httpsCallable<{targetId:string;targetType:string},Editable>(services.functions,'getManagedArchiveResource')({targetId:id,targetType:type}).then(result=>{
   if(active){setValue(result.data);setInitial(JSON.stringify(result.data))}
  }).catch(()=>{if(active)setError('수정할 내용을 불러오지 못했어요. 다시 시도해 주세요.')});
  return()=>{active=false};
 },[id,type,access.administrator,reload]);
 const cancel=()=>{if(!dirty||window.confirm('수정한 내용을 저장하지 않고 나갈까요?'))navigate(returnTo)};
 const save=async()=>{
  if(!value||saving)return;
  if(!value.title.trim()||reason.trim().length<2){setError('제목과 수정 사유를 입력해 주세요.');return}
  setSaving(true);setError('');
  try{
   const services=getFirebaseServices();if(!services)throw Error();
   await httpsCallable(services.functions,'updateManagedArchiveResource')({targetType:type,targetId:id,...value,reason:reason.trim()});
   setInitial(JSON.stringify(value));navigate(returnTo,{replace:true});
  }catch(e){const code=e&&typeof e==='object'&&'code'in e?e.code:'';setError(code==='functions/aborted'?'다른 수정이 먼저 저장됐어요. 작성한 내용을 복사해 두고 다시 불러와 주세요.':'저장하지 못했어요. 본문과 수정 사유를 확인한 뒤 다시 시도해 주세요.')}
  finally{setSaving(false)}
 };
 if(access.state==='checking')return <p role="status">수정 권한을 확인하고 있어요</p>;
 if(!access.administrator)return <section><p role="alert">관리자 계정으로 로그인한 뒤 수정해 주세요.</p><Link className="button button-secondary" to="/profile">로그인 화면으로</Link></section>;
 if(!id||!['material','activity','submission','bundle','collection'].includes(type))return <p role="alert">수정할 자료를 확인해 주세요.</p>;
 return <section aria-label="자료 수정"><button className="button button-quiet" type="button" disabled={saving} onClick={cancel}><ArrowLeft size={18}/>이전 화면으로</button>
 {!value&&!error&&<p role="status">수정할 내용을 불러오는 중이에요</p>}
 {error&&<div className="contribution-message error" role="alert"><p>{error}</p><button type="button" className="button button-secondary" disabled={saving} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 내용을 버리고 다시 불러올까요?')){setValue(null);setError('');setReason('');setReload(n=>n+1)}}}>다시 불러오기</button></div>}
 {value&&<form className={`contribution-form ${styles.form}`} onSubmit={event=>{event.preventDefault();void save()}}>
  <fieldset className="contribution-step" disabled={saving}><legend>기본 내용</legend><div className="contribution-fields">
   <label><span>제목 <FieldRequirement/></span><input required maxLength={160} value={value.title} onChange={event=>setValue({...value,title:event.target.value})}/></label>
   {type!=='collection'&&<label><span>출처 <FieldRequirement optional/></span><input maxLength={500} value={value.source} onChange={event=>setValue({...value,source:event.target.value})}/></label>}
  </div></fieldset>
  <fieldset className="contribution-step" disabled={saving}><legend>{value.plainOnly?'자료 설명':'본문 작성'}</legend>
   {value.plainOnly?<label>설명<textarea className={styles.managedDescription} rows={10} maxLength={5000} value={value.body} onChange={event=>setValue({...value,body:event.target.value})}/></label>:<TextComposer value={value.body} onChange={body=>setValue({...value,body})} format={value.format} onFormatChange={format=>setValue({...value,format})}/>}
  </fieldset>
  <fieldset className="contribution-step" disabled={saving}><legend>수정 사유</legend><label><span>변경한 내용 <FieldRequirement/></span><input required minLength={2} maxLength={300} placeholder="예: 회의 날짜와 본문 오탈자 수정" value={reason} onChange={event=>setReason(event.target.value)}/></label></fieldset>
  <div className={`contribution-submit ${styles.submitBar}`}><Save size={22}/><p><b>수정한 내용을 저장해요</b></p><button className="button button-secondary" type="button" disabled={saving} onClick={cancel}>취소</button><button className="button button-primary" type="submit" disabled={saving}>{saving?'저장 중':'수정 저장'}</button></div>
 </form>}</section>;
}
