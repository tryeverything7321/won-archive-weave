import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {getFirestore} from 'firebase-admin/firestore'
import {getManagedArchiveResource,updateManagedArchiveResource} from './resource-editing.js'
test('administrator edits orphan documents and aliases with conflict protection and audit', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const db=getFirestore(),id='edit-'+randomUUID(),admin={uid:id,token:{role:'administrator'}}
 const invoke=<T>(fn:{run:(request:never)=>T},data:unknown,auth:unknown=admin)=>fn.run({auth,data} as never)
 const target={targetType:'material',targetId:id},paths=['materials/'+id,'activities/'+id]
 try{
  await db.doc('users/'+id).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'})
  for(const path of paths)await db.doc(path).set({title:'회의록',story:'기존 본문',ownerUid:'original-owner',status:'published',visibility:'member_only',sourceMode:'text',approvedStoragePath:'preserved-file',rights:{source:'청년회',redistribution:'view_only'}})
  await assert.rejects(invoke(getManagedArchiveResource,target,{uid:id,token:{role:'moderator'}}),(e:{code?:string})=>e.code==='permission-denied')
  await assert.rejects(invoke(updateManagedArchiveResource,target,null),(e:{code?:string})=>e.code==='unauthenticated')
  await assert.rejects(invoke(updateManagedArchiveResource,target,{uid:id,token:{}}),(e:{code?:string})=>e.code==='permission-denied')
  const before=await invoke(getManagedArchiveResource,target)
  assert.equal(before.body,'기존 본문');assert.ok(!('ownerUid'in before));assert.ok(!('approvedStoragePath'in before))
  const input={...target,...before,title:'수정된 회의록',body:'  안건  하나\n    결정 사항',source:'원불교 청년회',reason:'오탈자 수정'}
  await assert.rejects(invoke(updateManagedArchiveResource,{...input,body:''}),(e:{code?:string})=>e.code==='invalid-argument')
  await invoke(updateManagedArchiveResource,input)
  for(const path of paths){const d=(await db.doc(path).get()).data()!;assert.equal(d.title,input.title);assert.equal(d.textContent.body,input.body);assert.equal(d.ownerUid,'original-owner');assert.equal(d.status,'published');assert.equal(d.visibility,'member_only');assert.equal(d.approvedStoragePath,'preserved-file')}
  assert.equal((await db.doc(paths[1]).get()).get('story'),input.body)
  assert.equal((await db.doc(paths[0]).get()).get('rights.redistribution'),'view_only')
  assert.equal((await db.doc('submissions/'+id).get()).exists,false)
  await assert.rejects(invoke(updateManagedArchiveResource,input),(e:{code?:string})=>e.code==='aborted')
  const events=await db.collection('auditEvents').where('targetId','==',id).get();assert.equal(events.size,1);assert.equal(events.docs[0].get('type'),'archive_resource.edited');assert.equal(events.docs[0].get('reason'),'오탈자 수정')
  await db.doc(paths[0]).update({deletedFromListings:true})
  await assert.rejects(invoke(getManagedArchiveResource,target),(e:{code?:string})=>e.code==='not-found')
  await Promise.all(events.docs.map(doc=>doc.ref.delete()))
 }finally{await db.doc('users/'+id).delete();await Promise.all(paths.map(path=>db.doc(path).delete()))}
})
