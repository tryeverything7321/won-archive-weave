import {createHash} from 'node:crypto'
import {getApps,initializeApp} from 'firebase-admin/app'
import {getFirestore,FieldValue,type DocumentSnapshot} from 'firebase-admin/firestore'
import {onCall,HttpsError} from 'firebase-functions/v2/https'
import {requireActorPolicy} from '../community/actor-policy.js'
import {normalizeTextContent} from '../uploads/text-content.js'
import {archiveId,boundedText} from './model.js'
if(!getApps().length)initializeApp()
const paths={material:'materials',activity:'activities',submission:'submissions',bundle:'materialBundles',collection:'archiveCollections'} as const
type Kind=keyof typeof paths
function target(data:Record<string,unknown>){
 const type=data.targetType
 if(typeof type!=='string'||!Object.hasOwn(paths,type))throw new HttpsError('invalid-argument','수정할 자료 종류를 확인해 주세요')
 return {type:type as Kind,id:archiveId(data.targetId)}
}
function refs(type:Kind,id:string){const db=getFirestore();return (['material','activity','submission'].includes(type)?['materials','activities','submissions']:[paths[type]]).map(path=>db.doc(path+'/'+id))}
async function administrator(auth:Parameters<typeof requireActorPolicy>[0]){
 const actor=await requireActorPolicy(auth,{allowRoles:['administrator']})
 if(auth?.token?.role!=='administrator')throw new HttpsError('permission-denied','관리자만 이 자료를 수정할 수 있어요')
 return actor
}
function revision(docs:DocumentSnapshot[]){return createHash('sha256').update(JSON.stringify(docs.map(doc=>[doc.ref.path,doc.updateTime?.seconds,doc.updateTime?.nanoseconds]))).digest('hex')}
function editable(doc:DocumentSnapshot,type:Kind){
 if(!doc.exists||doc.get('deletedFromListings')===true)throw new HttpsError('not-found','수정할 자료를 찾지 못했어요')
 const data=doc.data()??{},text=normalizeTextContent(data.textContent)
 const plain=type==='bundle'||type==='collection'
 return {title:String(data.title??''),body:plain?String(data.description??''):text?.body??(typeof data.story==='string'?data.story:''),format:plain?'plain' as const:text?.format??'plain' as const,source:typeof data.rights?.source==='string'?data.rights.source:typeof data.source==='string'?data.source:'',plainOnly:plain}
}
export const getManagedArchiveResource=onCall({region:'asia-northeast3'},async request=>{
 await administrator(request.auth)
 const {type,id}=target(request.data??{}),docs=await getFirestore().getAll(...refs(type,id))
 const doc=docs.find(value=>value.ref.path===paths[type]+'/'+id)!
 return {...editable(doc,type),revision:revision(docs)}
})
export const updateManagedArchiveResource=onCall({region:'asia-northeast3'},async request=>{
 const {uid}=await administrator(request.auth),{type,id}=target(request.data??{})
 const title=boundedText(request.data?.title,'제목',160),source=boundedText(request.data?.source,'출처',500,{optional:true}),reason=boundedText(request.data?.reason,'수정 사유',300)
 if(reason.length<2)throw new HttpsError('invalid-argument','수정 사유를 2자 이상 입력해 주세요')
 const text=normalizeTextContent({format:request.data?.format,body:request.data?.body})
 const expected=boundedText(request.data?.revision,'수정 기준',64)
 const db=getFirestore()
 await db.runTransaction(async tx=>{
  const docs=await Promise.all(refs(type,id).map(ref=>tx.get(ref))),doc=docs.find(value=>value.ref.path===paths[type]+'/'+id)!
  const before=editable(doc,type)
  if(revision(docs)!==expected)throw new HttpsError('aborted','다른 수정이 먼저 저장됐어요. 닫고 다시 열어 최신 내용을 확인해 주세요')
  if(before.plainOnly&&request.data?.format!=='plain')throw new HttpsError('invalid-argument','자료 설명은 입력한 모양으로 저장해 주세요')
  if(doc.get('sourceMode')==='text'&&!text)throw new HttpsError('invalid-argument','본문을 입력해 주세요')
  if(before.plainOnly&&(text?.body.length??0)>5000)throw new HttpsError('invalid-argument','자료 설명은 5,000자 이하로 입력해 주세요')
  for(const current of docs){
   if(!current.exists)continue
   if(current.get('deletedFromListings')===true)throw new HttpsError('failed-precondition','삭제된 자료는 수정할 수 없어요')
   const update:Record<string,unknown>={title,updatedAt:FieldValue.serverTimestamp(),updatedAtMs:Date.now()}
   if(type==='bundle'||type==='collection')update.description=text?.body??''
   else {update.textContent=text??FieldValue.delete();if(current.ref.parent.id==='activities')update.story=text?.body??''}
   if(current.ref.parent.id==='submissions'||current.ref.parent.id==='activities'||typeof current.get('source')==='string')update.source=source
   if(current.ref.parent.id!=='submissions'&&current.ref.parent.id!=='activities'&&type!=='collection')update['rights.source']=source
   tx.update(current.ref,update)
  }
  tx.create(db.collection('auditEvents').doc(),{type:'archive_resource.edited',actorUid:uid,targetType:type,targetId:id,reason,before,after:{title,body:text?.body??'',format:request.data?.format,source},at:FieldValue.serverTimestamp()})
 })
 return {saved:true}
})
