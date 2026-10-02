import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {getFirestore,Timestamp} from 'firebase-admin/firestore'
import {isQcResourceTitle,listManagedArchiveResources,manageQcResources,withdrawArchiveResource} from './resource-management.js'
import {searchArchiveDiscovery} from './discovery.js'
import {listMySubmissions,requestSubmissionChange} from '../uploads/submissions.js'

test('QC recognition includes bracketed test labels without matching ordinary words',()=>{
 for(const title of ['[QC] 파일 공개 검증','QC-2026-public-CSV',' QC 테스트'])assert.equal(isQcResourceTitle(title),true)
 for(const title of ['QCon 행사','회의록','정기훈련 QC 참고'])assert.equal(isQcResourceTitle(title),false)
})
test('admin can remove legacy orphans, reviewed QC and withdrawn drafts; public discovery never exposes stopped content', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const db=getFirestore(),tag='resource-'+randomUUID(),uid=tag,other=tag+'-other',auth={uid,token:{}},admin={uid,token:{role:'administrator'}}
 const invoke=<T>(fn:{run:(request:never)=>T},data:unknown,actor:unknown=admin)=>fn.run({auth:actor,data} as never)
 const paths:string[]=[]
 const put=async(path:string,value:object)=>{paths.push(path);await db.doc(path).set(value)}
 try{
  for(const name of [uid,other])await put('users/'+name,{connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'})
  await put('materialBundles/'+tag,{ownerUid:uid,title:'정기훈련 자료',description:'',status:'active',visibility:'member_only',files:{},createdAtMs:1,updatedAtMs:1})
  await assert.rejects(invoke(withdrawArchiveResource,{targetType:'bundle',targetId:tag},{uid:other,token:{}}),(e:{code?:string})=>e.code==='permission-denied')
  const normal=tag+'-normal',orphan=tag+'-orphan',stopped=tag+'-stopped',draft=tag+'-draft'
  await put('materials/'+normal,{title:'회의록 '+tag,status:'published',visibility:'public',createdAt:Timestamp.now()})
  await put('materials/'+orphan,{title:'[QC] 파일 검증 '+tag,status:'published',visibility:'public',createdAt:Timestamp.now()})
  await put('activities/'+orphan,{title:'[QC] 파일 검증 '+tag,status:'published',visibility:'public'})
  await put('materials/'+stopped,{title:'QC-'+tag,status:'unpublished',visibility:'public',createdAt:Timestamp.now()})
  await put('submissions/'+stopped,{ownerUid:uid,title:'QC-'+tag,status:'unpublished',visibility:'누구나 공개',kind:'자료'})
  await put('submissions/'+draft,{ownerUid:uid,title:'QC-'+tag+'-draft',status:'withdrawn',visibility:'보류',kind:'자료'})
  const found=await invoke(searchArchiveDiscovery,{scope:'resources',keyword:tag})
  assert.ok(found.items.some((x:{id:string})=>x.id===normal));assert.ok(!found.items.some((x:{id:string})=>x.id===stopped),'admin browsing must exclude unpublished material')
  const managed=await invoke(listManagedArchiveResources,{keyword:tag})
  for(const id of [normal,orphan,stopped,draft])assert.ok(managed.items.some((x:{id:string})=>x.id===id),'management includes '+id)
  await assert.rejects(invoke(listManagedArchiveResources,{},auth),(e:{code?:string})=>e.code==='permission-denied')
  await assert.rejects(invoke(withdrawArchiveResource,{targetType:'material',targetId:orphan,reason:'QC 삭제'},auth),(e:{code?:string})=>e.code==='permission-denied')
  await assert.rejects(invoke(withdrawArchiveResource,{targetType:'material',targetId:normal}),(e:{code?:string})=>e.code==='invalid-argument')
  const before=await invoke(manageQcResources,{remove:false})
  const targets=(before.items??[]).filter((x:{id:string})=>[orphan,stopped,draft].includes(x.id))
  assert.equal(targets.length,3)
  const late=tag+'-late';await put('materials/'+late,{title:'QC-'+tag+'-late',status:'published',visibility:'public'})
  await assert.rejects(invoke(manageQcResources,{remove:true,targets:[{targetType:'material',id:normal}]}),(e:{code?:string})=>e.code==='failed-precondition')
  const removed=await invoke(manageQcResources,{remove:true,targets})
  assert.equal(removed.removed,3)
  for(const path of ['materials/'+orphan,'activities/'+orphan,'materials/'+stopped,'submissions/'+stopped,'submissions/'+draft]){
   const doc=await db.doc(path).get();assert.equal(doc.get('status'),'withdrawn');assert.equal(doc.get('deletedFromListings'),true)
  }
  assert.equal((await db.doc('materials/'+normal).get()).get('status'),'published')
  assert.equal((await db.doc('materials/'+late).get()).get('status'),'published','unreviewed new QC preserved')
  const mine=await invoke(listMySubmissions,{},auth);assert.ok(!mine.submissions.some((x:{id:string})=>[stopped,draft].includes(x.id)))
  await assert.rejects(invoke(requestSubmissionChange,{submissionId:stopped,action:'restore_private'},auth),(e:{code?:string})=>e.code==='failed-precondition')
  assert.equal((await invoke(manageQcResources,{remove:true,targets})).removed,0,'retry is idempotent')
  await invoke(withdrawArchiveResource,{targetType:'material',targetId:normal,reason:'관리자 테스트 자료 삭제'})
  assert.equal((await db.doc('materials/'+normal).get()).get('deletedFromListings'),true,'orphan can be managed without submission')
  await invoke(withdrawArchiveResource,{targetType:'bundle',targetId:tag},auth)
  assert.equal((await db.doc('materialBundles/'+tag).get()).get('status'),'withdrawn')
 }finally{await Promise.all(paths.map(path=>db.doc(path).delete()))}
})
