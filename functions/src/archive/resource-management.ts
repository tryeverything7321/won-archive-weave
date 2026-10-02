import {getApps,initializeApp} from 'firebase-admin/app'
import {FieldValue,getFirestore} from 'firebase-admin/firestore'
import {onCall,HttpsError} from 'firebase-functions/v2/https'
import {requireActorPolicy} from '../community/actor-policy.js'
import {archiveId} from './model.js'
if(!getApps().length)initializeApp()
const paths={bundle:'materialBundles',collection:'archiveCollections',material:'materials'} as const
const qcTitle=(value:unknown)=>typeof value==='string'&&/^QC(?:\b|[\s:_-])/i.test(value.trim())

export const withdrawArchiveResource=onCall({region:'asia-northeast3'},async request=>{
 const {uid}=await requireActorPolicy(request.auth)
 const type:unknown=request.data?.targetType
 if(type!=='bundle'&&type!=='collection')throw new HttpsError('invalid-argument','삭제할 자료를 선택해 주세요')
 const id=archiveId(request.data?.targetId),db=getFirestore(),ref=db.doc(paths[type]+'/'+id)
 await db.runTransaction(async tx=>{
  const snapshot=await tx.get(ref)
  if(!snapshot.exists||snapshot.get('ownerUid')!==uid)throw new HttpsError('permission-denied','내가 올린 자료만 삭제할 수 있어요')
  if(snapshot.get('status')==='withdrawn')return
  tx.update(ref,{status:'withdrawn',updatedAt:FieldValue.serverTimestamp(),updatedAtMs:Date.now()})
  tx.create(db.collection('auditEvents').doc(),{type:'archive_resource.withdrawn',actorUid:uid,targetType:type,targetId:id,at:FieldValue.serverTimestamp()})
 })
 return {withdrawn:true}
})

export const manageQcResources=onCall({region:'asia-northeast3'},async request=>{
 const {uid}=await requireActorPolicy(request.auth,{allowRoles:['administrator']})
 if(request.auth?.token.role!=='administrator')throw new HttpsError('permission-denied','관리자만 테스트 기록을 정리할 수 있어요')
 const db=getFirestore(),docs=(await Promise.all(Object.entries(paths).map(async([type,path])=>await db.collection(path).limit(1001).get().then(snapshot=>{if(snapshot.size>1000)throw new HttpsError('resource-exhausted','관리 목록에서 대상을 나누어 정리해 주세요');return snapshot.docs.map(doc=>({type,doc}))})))).flat()
 if(docs.length>3000)throw new HttpsError('resource-exhausted','관리 목록에서 대상을 나누어 정리해 주세요')
 const matches=docs.filter(({doc})=>doc.get('status')!=='withdrawn'&&qcTitle(doc.get('title')))
 if(request.data?.remove!==true)return {items:matches.map(({type,doc})=>({targetType:type,id:doc.id,title:doc.get('title')}))}
 if(matches.length>50)throw new HttpsError('resource-exhausted','테스트 기록이 50개보다 많아 운영 센터에서 나누어 정리해야 해요')
 let removed=0
 await db.runTransaction(async tx=>{
  const current=await Promise.all(matches.map(({doc})=>tx.get(doc.ref)))
  const aliases=await Promise.all(matches.map(({type,doc})=>type==='material'?Promise.all([tx.get(db.doc('activities/'+doc.id)),tx.get(db.doc('submissions/'+doc.id))]):Promise.resolve([])))
  removed=0
  for(const [index,doc] of current.entries()){
   if(!doc.exists||doc.get('status')==='withdrawn'||!qcTitle(doc.get('title')))continue
   tx.update(doc.ref,{status:'withdrawn',updatedAt:FieldValue.serverTimestamp(),updatedAtMs:Date.now()})
   // A legacy material may also have an activity publication: revoke that existing alias.
   for(const alias of aliases[index]??[])if(alias.exists)tx.update(alias.ref,{status:'withdrawn',updatedAt:FieldValue.serverTimestamp()})
   tx.create(db.collection('auditEvents').doc(),{type:'qc_resource.withdrawn',actorUid:uid,targetType:matches[index]!.type,targetId:doc.id,at:FieldValue.serverTimestamp()})
   removed++
  }
 })
 return {removed}
})
