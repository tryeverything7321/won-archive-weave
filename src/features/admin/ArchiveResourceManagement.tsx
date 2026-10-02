import {ManagedResourceEditor} from "./ManagedResourceEditor";
import archiveStyles from "../event-archive/EventArchive.module.css";
import {useCallback,useEffect,useState} from 'react';
import {httpsCallable} from 'firebase/functions';
import {Trash2,RefreshCw} from 'lucide-react';
import {getFirebaseServices} from '../../lib/firebase/client';
import {useOperatorAccess} from '../auth/useOperatorAccess';
import {ActionDialog,type ActionDialogRequest} from './ActionDialog';
import styles from './ContentModerationPanel.module.css';
export type ManagedResourceType='material'|'activity'|'submission'|'bundle'|'collection';
type Target={targetType:ManagedResourceType;id:string;title:string};
type ManagedItem=Target&{status:string};
async function call<T>(name:string,data:unknown):Promise<T>{const services=getFirebaseServices();if(!services)throw Error('not configured');return (await httpsCallable<unknown,T>(services.functions,name)(data)).data}

export function AdminResourceDeleteButton({id,type,title,onDeleted}:{id:string;type:ManagedResourceType;title:string;onDeleted:()=>void}){
 const [dialog,setDialog]=useState<ActionDialogRequest|null>(null);
 return <><button className="button button-quiet" type="button" aria-label={`${title} 관리자 삭제`} onClick={()=>setDialog({title:'자료 삭제',target:title,description:'자료 나눔과 연결된 화면, 내 위브 목록에서 삭제합니다. 원본과 처리 이력은 보관됩니다.',confirmLabel:'삭제',requireReason:true,onConfirm:async reason=>{await call('withdrawArchiveResource',{targetType:type,targetId:id,reason});onDeleted()}})}><Trash2 size={16}/>삭제</button><ActionDialog request={dialog} onClose={()=>setDialog(null)}/></>
}

export function AdminResourceActions(props:{id:string;type:ManagedResourceType;title:string;onDeleted:()=>void}){
 return <div className={archiveStyles.rowActions}><ManagedResourceEditor id={props.id} type={props.type} title={props.title}/><AdminResourceDeleteButton {...props}/></div>
}

export function QcResourceCleanup({onDeleted}:{onDeleted?:()=>void}){
 const access=useOperatorAccess();
 const [items,setItems]=useState<Target[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [dialog,setDialog]=useState<ActionDialogRequest|null>(null);
 const load=async()=>{setBusy(true);setMessage('');try{const result=await call<{items:Target[]}>('manageQcResources',{remove:false});setItems(result.items)}catch{setMessage('QC 목록을 불러오지 못했어요. 다시 시도해 주세요.')}finally{setBusy(false)}};
 if(!access.administrator)return null;
 const selected=items?.slice(0,50)??[];
 return <div className={styles.cleanup}>
  <button className="button button-secondary" type="button" disabled={busy} onClick={()=>void load()}>QC 테스트 정리</button>
  {items&&<><p>{items.length?`QC 기록 ${items.length}건을 찾았어요. 아래 제목을 확인해 주세요.`:'정리할 QC 기록이 없어요'}</p><ul className={styles.qcList}>{selected.map(item=><li key={item.targetType+item.id}>{item.title}</li>)}</ul>{selected.length>0&&<button className="button button-primary" type="button" onClick={()=>setDialog({title:'QC 테스트 기록 삭제',target:`확인한 ${selected.length}건`,description:'위 목록에서 확인한 테스트 기록을 자료 나눔과 내 위브 목록에서 삭제합니다. 원본과 감사 이력은 보관됩니다.',confirmLabel:`${selected.length}건 삭제`,onConfirm:async()=>{const result=await call<{removed:number}>('manageQcResources',{remove:true,targets:selected.map(({targetType,id})=>({targetType,id}))});setItems(null);setMessage(`${result.removed}건을 삭제했어요`);onDeleted?.()}})}>확인한 {selected.length}건 삭제</button>}</>}
  {message&&<p role="status">{message}</p>}<ActionDialog request={dialog} onClose={()=>setDialog(null)}/>
 </div>
}
const statusLabels:Record<string,string>={published:'공개',active:'공개',draft:'초안',unpublished:'공개 중단',withdrawn:'철회',held:'숨김',review_queued:'확인 대기',revision_requested:'수정 요청'};
export function ArchiveResourceManagement(){
 const access=useOperatorAccess();
 const [items,setItems]=useState<ManagedItem[]>([]),[cursor,setCursor]=useState<string|null>(null),[keyword,setKeyword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const load=useCallback(async(nextCursor:string|null=null)=>{setBusy(true);setMessage('');try{const result=await call<{items:ManagedItem[];nextCursor:string|null}>('listManagedArchiveResources',{keyword,cursor:nextCursor,limit:30});setItems(prior=>nextCursor?[...prior,...result.items]:result.items);setCursor(result.nextCursor)}catch{setMessage('자료 목록을 불러오지 못했어요. 다시 시도해 주세요.')}finally{setBusy(false)}},[keyword]);
 useEffect(()=>{if(!access.administrator)return;const timer=setTimeout(()=>void load(),250);return()=>clearTimeout(timer)},[access.administrator,load]);
 if(!access.administrator)return null;
 return <section className={styles.panel} aria-label="전체 자료 관리"><h2>전체 자료 관리</h2><p>공개 중단·철회된 자료와 이전에 등록된 자료까지 확인하고 삭제할 수 있어요.</p><QcResourceCleanup onDeleted={()=>void load()}/><label>자료 제목 검색<input type="search" value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="자료 제목 검색"/></label><button className="button button-secondary" type="button" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/>새로고침</button>{busy&&<p role="status">자료를 불러오는 중이에요</p>}{message&&<p role="alert">{message}</p>}<div>{items.map(item=><article className={styles.managedRow} key={item.targetType+item.id}><div><strong>{item.title}</strong><span>{statusLabels[item.status]??'상태 확인 필요'}</span></div><AdminResourceActions id={item.id} type={item.targetType} title={item.title} onDeleted={()=>void load()}/></article>)}</div>{!busy&&!message&&!items.length&&<p>조건에 맞는 자료가 없어요</p>}{cursor&&<button className="button button-secondary" type="button" disabled={busy} onClick={()=>void load(cursor)}>이전 자료 더 보기</button>}</section>
}
