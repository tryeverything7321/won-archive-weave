import {getApps,initializeApp} from 'firebase-admin/app'
import {FieldValue,getFirestore,type QueryDocumentSnapshot} from 'firebase-admin/firestore'
import {onCall,HttpsError} from 'firebase-functions/v2/https'
import {requireActorPolicy} from '../community/actor-policy.js'
import {archiveId,archivePageSize,decodeArchiveCursor,encodeArchiveCursor,isAfterArchiveCursor} from './model.js'
if(!getApps().length)initializeApp()
const paths={bundle:'materialBundles',collection:'archiveCollections',material:'materials',activity:'activities',submission:'submissions'} as const
type ResourceType=keyof typeof paths
export const isQcResourceTitle=(value:unknown)=>typeof value==='string'&&/^(?:\[QC\]|QC(?:\b|[\s:_-]))/i.test(value.trim())
const resourceType=(value:unknown):ResourceType=>{if(typeof value!=='string'||!Object.hasOwn(paths,value))throw new HttpsError('invalid-argument','자료 종류를 확인해 주세요');return value as ResourceType}
const aliases=(type:ResourceType,id:string)=>type==='material'||type==='activity'||type==='submission'?['materials/','activities/','submissions/'].map(path=>path+id):[paths[type]+'/'+id]
async function requireAdministrator(auth:Parameters<typeof requireActorPolicy>[0]){
 const actor=await requireActorPolicy(auth,{allowRoles:['administrator']})
 if(auth?.token?.role!=='administrator')throw new HttpsError('permission-denied','관리자만 자료를 정리할 수 있어요')
 return actor
}
async function managedRecords(){
 const db=getFirestore()
 const sources=await Promise.all(Object.entries(paths).map(async([type,path])=>{
  const snapshot=await db.collection(path).limit(1001).get()
  if(snapshot.size>1000)throw new HttpsError('resource-exhausted','관리 목록의 조회 범위를 나누어야 해요')
  return snapshot.docs.map(doc=>({type:type as ResourceType,doc}))
 }))
 const grouped=new Map<string,{type:ResourceType;doc:QueryDocumentSnapshot}>()
 // Public records take precedence, with submission-only drafts included too.
 for(const entry of sources.flat()){
  const key=entry.type==='bundle'||entry.type==='collection'?entry.type+':'+entry.doc.id:'legacy:'+entry.doc.id
  if(!grouped.has(key))grouped.set(key,entry)
 }
 return [...grouped.values()].filter(({doc})=>doc.get('deletedFromListings')!==true)
}
function modifiedMs(doc:QueryDocumentSnapshot):number{
 for(const key of ['updatedAtMs','createdAtMs','updatedAt','createdAt']){
  const value=doc.get(key)
  if(typeof value==='number'&&Number.isFinite(value))return value
  if(value&&typeof value.toMillis==='function')return value.toMillis()
 }
 return 0
}
export const listManagedArchiveResources=onCall({region:'asia-northeast3'},async request=>{
 await requireAdministrator(request.auth)
 const cursor=decodeArchiveCursor(request.data?.cursor),limit=archivePageSize(request.data?.limit)
 const keyword=typeof request.data?.keyword==='string'?request.data.keyword.trim().slice(0,160).toLowerCase():''
 const rows=(await managedRecords()).map(({type,doc})=>({targetType:type,id:doc.id,title:String(doc.get('title')||'제목 없는 자료').slice(0,180),status:String(doc.get('status')||'unknown'),sortMs:modifiedMs(doc)}))
  .filter(row=>!keyword||row.title.toLowerCase().includes(keyword))
  .sort((a,b)=>b.sortMs-a.sortMs||b.targetType.localeCompare(a.targetType)||b.id.localeCompare(a.id))
 const remaining=rows.filter(row=>isAfterArchiveCursor({sortMs:row.sortMs,kind:row.targetType,id:row.id},cursor))
 const items=remaining.slice(0,limit),last=items.at(-1),hasMore=remaining.length>limit
 return {items,totalCount:rows.length,nextCursor:hasMore&&last?encodeArchiveCursor({sortMs:last.sortMs,kind:last.targetType,id:last.id}):null}
})

export const withdrawArchiveResource=onCall({region:'asia-northeast3'},async request=>{
 const administrator=request.auth?.token.role==='administrator'
 const {uid}=await requireActorPolicy(request.auth,administrator?{allowRoles:['administrator']}:undefined)
 const type=resourceType(request.data?.targetType),id=archiveId(request.data?.targetId)
 if(!administrator&&type!=='bundle'&&type!=='collection')throw new HttpsError('permission-denied','관리자 권한이 필요해요')
 const reason=typeof request.data?.reason==='string'?request.data.reason.trim():''
 const db=getFirestore()
 await db.runTransaction(async tx=>{
  const refs=aliases(type,id).map(path=>db.doc(path)),docs=await Promise.all(refs.map(ref=>tx.get(ref)))
  const target=docs.find(doc=>doc.ref.path===paths[type]+'/'+id)
  if(!target?.exists)throw new HttpsError('not-found','자료를 찾지 못했어요')
  if(administrator&&(target.get('ownerUid')!==uid||!['bundle','collection'].includes(type))&&(reason.length<2||reason.length>300))throw new HttpsError('invalid-argument','삭제 사유를 2~300자로 입력해 주세요')
  if(!administrator&&target.get('ownerUid')!==uid)throw new HttpsError('permission-denied','내가 올린 자료만 삭제할 수 있어요')
  if(docs.every(doc=>!doc.exists||doc.get('deletedFromListings')===true))return
  for(const doc of docs)if(doc.exists)tx.update(doc.ref,{status:'withdrawn',deletedFromListings:true,updatedAt:FieldValue.serverTimestamp(),updatedAtMs:Date.now()})
  tx.create(db.collection('auditEvents').doc(),{type:'archive_resource.withdrawn',status:'withdrawn',actorUid:uid,targetType:type,targetId:id,...(administrator?{reason}:{}),at:FieldValue.serverTimestamp()})
 })
 return {withdrawn:true}
})

export const manageQcResources=onCall({region:'asia-northeast3'},async request=>{
 const {uid}=await requireAdministrator(request.auth)
 if(request.data?.remove!==true){
  const matches=(await managedRecords()).filter(({doc})=>isQcResourceTitle(doc.get('title')))
  return {items:matches.map(({type,doc})=>({targetType:type,id:doc.id,title:doc.get('title')}))}
 }
 const raw=request.data?.targets
 if(!Array.isArray(raw)||!raw.length||raw.length>50)throw new HttpsError('invalid-argument','먼저 삭제할 QC 기록을 최대 50개 선택해 주세요')
 const targets=raw.map(item=>({type:resourceType(item?.targetType),id:archiveId(item?.id)}))
 const db=getFirestore()
 let removed=0
 await db.runTransaction(async tx=>{
  const allPaths=[...new Set(targets.flatMap(item=>aliases(item.type,item.id)))]
  const docs=await Promise.all(allPaths.map(path=>tx.get(db.doc(path))))
  const byPath=new Map(docs.map(doc=>[doc.ref.path,doc]))
  for(const target of targets){
   const doc=byPath.get(paths[target.type]+'/'+target.id)
   if(!doc?.exists||!isQcResourceTitle(doc.get('title')))throw new HttpsError('failed-precondition','QC 대상이 변경됐어요. 목록을 다시 확인해 주세요')
  }
  removed=0
  const changed=new Set<string>()
  for(const target of targets){
   const matching=aliases(target.type,target.id).flatMap(path=>byPath.get(path)??[]).filter(doc=>doc.exists)
   if(matching.every(doc=>doc.get('deletedFromListings')===true))continue
   for(const doc of matching)if(!changed.has(doc.ref.path)){
    tx.update(doc.ref,{status:'withdrawn',deletedFromListings:true,updatedAt:FieldValue.serverTimestamp(),updatedAtMs:Date.now()});changed.add(doc.ref.path)
   }
   tx.create(db.collection('auditEvents').doc(),{type:'qc_resource.withdrawn',status:'withdrawn',actorUid:uid,targetType:target.type,targetId:target.id,reason:'관리자 QC 테스트 기록 정리',at:FieldValue.serverTimestamp()})
   removed++
  }
 })
 return {removed}
})
