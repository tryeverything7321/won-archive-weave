import {getApps, initializeApp} from 'firebase-admin/app'
import {getFirestore,FieldValue} from 'firebase-admin/firestore'
import {HttpsError,onCall} from 'firebase-functions/v2/https'
import {requireActorPolicy} from '../community/actor-policy.js'

if (!getApps().length) initializeApp()

export const classifySubmissionAsMaterial=onCall({region:'asia-northeast3'},async request=>{
 const {uid}=await requireActorPolicy(request.auth,{allowRoles:['administrator','moderator']})
 const id=typeof request.data?.submissionId==='string'?request.data.submissionId:''
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new HttpsError('invalid-argument','자료를 선택해 주세요')
 const db=getFirestore(), submission=db.doc('submissions/'+id), activity=db.doc('activities/'+id), material=db.doc('materials/'+id)
 const operator=request.auth?.token.role==='administrator'||request.auth?.token.role==='moderator'
 await db.runTransaction(async tx=>{
  const [source,record,file]=await Promise.all([tx.get(submission),tx.get(activity),tx.get(material)])
  if(!source.exists||!record.exists||!file.exists)throw new HttpsError('not-found','이동할 자료를 찾지 못했어요')
  if(source.get('ownerUid')!==uid&&!operator)throw new HttpsError('permission-denied','내가 작성한 기록만 옮길 수 있어요')
  if(source.get('status')!=='published'||record.get('status')!=='published'||file.get('status')!=='published')throw new HttpsError('failed-precondition','게시된 기록만 자료 나눔으로 옮길 수 있어요')
  if(!['활동 기록','자료'].includes(source.get('kind')))throw new HttpsError('failed-precondition','이 기록은 현재 분류를 유지해 주세요')
  if(record.get('materialRedirectId')===id&&source.get('kind')==='자료')return
  const at=FieldValue.serverTimestamp()
  tx.update(submission,{kind:'자료',updatedAt:at})
  tx.update(material,{kind:'자료',updatedAt:at})
  // Keep the previous public URL and references as a redirect; preserve visibility and source.
  tx.update(activity,{materialRedirectId:id,updatedAt:at})
  tx.create(db.collection('auditEvents').doc(),{type:'submission.classified_as_material',submissionId:id,actorUid:uid,operator,at})
 })
 return {submissionId:id,href:'/materials/'+id}
})
