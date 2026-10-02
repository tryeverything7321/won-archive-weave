import test from 'node:test'
import assert from 'node:assert/strict'
import {getFirestore,Timestamp} from '../functions/node_modules/firebase-admin/lib/firestore/index.js'
import {ensureArchiveEventContext,getEventArchiveOverview} from '../functions/lib/archive/events.js'
import {linkArchiveRelation,unlinkArchiveRelation} from '../functions/lib/archive/relations.js'
import {createArchiveCollection,replaceArchiveCollectionItems,getArchiveCollection} from '../functions/lib/archive/collections.js'
import {searchArchiveDiscovery} from '../functions/lib/archive/discovery.js'
const enabled=process.env.GCLOUD_PROJECT==='demo-weave-rules'&&process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:18080'
test('year-only event, six files, two records, shared collections and private references preserve identity and access', {skip:!enabled},async()=>{
 const db=getFirestore(),tag='synthetic-archive-'+Date.now(),uid=tag+'-owner',other=tag+'-other'
 const auth={uid,token:{}},otherAuth={uid:other,token:{}}
 const created=[]
 const set=async(path,value)=>{await db.doc(path).set(value);created.push(path)}
 const invoke=(handler,data,actor=auth)=>handler.run({data,auth:actor})
 const command=()=>tag+'-'+Math.random().toString(36).slice(2)
 try{
  for(const id of [uid,other])await set('users/'+id,{connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'})
  const year=await invoke(ensureArchiveEventContext,{requestId:command(),title:'2025 합성 정기훈련',datePrecision:'year',heldYear:2025,region:tag,visibility:'public'})
  created.push('archiveEvents/'+year.archiveEventId)
  const saved=(await db.doc(created.at(-1)).get()).data();assert.equal(saved.datePrecision,'year');assert.equal(saved.heldYear,2025);assert.equal(saved.startDateKey,undefined)
  const files=Object.fromEntries(Array.from({length:6},(_,i)=>['file-'+i,{fileId:'file-'+i,revision:1,originalName:`${i+1}단.pptx`,displayName:`${i+1}단`,order:i,sizeBytes:100,contentType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',status:'ready',scanStatus:'clean'}]))
  const bundleId=tag+'-bundle'
  await set('materialBundles/'+bundleId,{ownerUid:uid,title:'단별 발표 자료',description:'',status:'active',visibility:'public',rights:{redistribution:'download_allowed'},files,createdAtMs:Date.parse('2025-12-31T15:30:00Z'),updatedAtMs:Date.now()})
  const refs=[{targetType:'bundle',targetId:bundleId}]
  for(let i=0;i<2;i++){const id=tag+'-activity-'+i;await set('activities/'+id,{title:'합성 기록 '+i,status:'published',visibility:'public',createdAt:Timestamp.now()});await set('submissions/'+id,{ownerUid:uid});refs.push({targetType:'activity',targetId:id})}
  for(const item of refs){const linked=await invoke(linkArchiveRelation,{requestId:command(),archiveEventId:year.archiveEventId,...item});created.push('archiveRelations/'+linked.relationId)}
  let overview=await invoke(getEventArchiveOverview,{archiveEventId:year.archiveEventId},null)
  assert.equal(overview.counts.bundleCount,1);assert.equal(overview.counts.fileCount,6);assert.equal(overview.counts.activityCount,2)
  const result=await invoke(searchArchiveDiscovery,{heldYear:2025,uploadYear:2026,region:tag},null)
  assert.ok(result.items.some(item=>item.targetType==='bundle'&&item.id===bundleId),'KST upload year and event year remain separate')
  const materialId=tag+'-meeting';await set('materials/'+materialId,{title:'합성 회의록 '+tag,status:'published',visibility:'public',sourceMode:'text',body:'합성 회의 내용',kind:'자료',rights:{redistribution:'view_only'},createdAt:Timestamp.now()});
  const unified=await invoke(searchArchiveDiscovery,{scope:'resources'},null);
  assert.ok(unified.items.some(item=>item.id===materialId&&item.targetType==='material'));
  assert.ok(unified.items.some(item=>item.id===bundleId&&item.targetType==='bundle'&&item.fileCount===6));
  assert.ok(unified.items.every(item=>['material','bundle'].includes(item.targetType)));
  const searched=await invoke(searchArchiveDiscovery,{scope:'resources',keyword:tag},null);
  assert.ok(searched.items.some(item=>item.id===materialId));assert.ok(searched.items.every(item=>item.title.includes(tag)));
  const collections=[]
  for(let i=0;i<2;i++){const c=await invoke(createArchiveCollection,{requestId:command(),title:'합성 모음 '+i,description:'',visibility:'public'});created.push('archiveCollections/'+c.collectionId);collections.push(c.collectionId);await invoke(replaceArchiveCollectionItems,{requestId:command(),collectionId:c.collectionId,items:refs})}
  await assert.rejects(invoke(replaceArchiveCollectionItems,{requestId:command(),collectionId:collections[0],items:[]},otherAuth),e=>e.code==='permission-denied')
  await invoke(replaceArchiveCollectionItems,{requestId:command(),collectionId:collections[0],items:[]})
  assert.ok((await db.doc('materialBundles/'+bundleId).get()).exists)
  const surviving=await invoke(getArchiveCollection,{collectionId:collections[1]},null);assert.equal(surviving.collection.items.length,3)
  await db.doc('materialBundles/'+bundleId).update({visibility:'hold'})
  const hidden=await getEventArchiveOverview.run({data:{archiveEventId:year.archiveEventId}})
  assert.equal(hidden.counts.bundleCount,0);assert.equal(hidden.counts.fileCount,0);assert.ok(!JSON.stringify(hidden).includes('단별 발표 자료'))
  const hiddenCollection=await getArchiveCollection.run({data:{collectionId:collections[1]}});assert.equal(hiddenCollection.collection.items.length,2)
  await invoke(unlinkArchiveRelation,{requestId:command(),archiveEventId:year.archiveEventId,...refs[0]})
  assert.ok((await db.doc('materialBundles/'+bundleId).get()).exists)
  const calendarId=tag+'-calendar';await set('calendarEvents/'+calendarId,{title:'연말 합성 행사',status:'published',visibility:'public',organizerName:'합성 주최',startAt:Timestamp.fromDate(new Date('2025-12-31T10:00:00+09:00')),endAt:Timestamp.fromDate(new Date('2026-01-01T12:00:00+09:00')),timeZone:'Asia/Seoul'})
  const canonical=await invoke(ensureArchiveEventContext,{requestId:command(),sourceCalendarEventId:calendarId});created.push('archiveEvents/'+canonical.archiveEventId);assert.equal(canonical.event.heldYear,2025)
  await db.doc('calendarEvents/'+calendarId).update({title:'변경된 합성 행사',eventState:'canceled'})
  const again=await invoke(ensureArchiveEventContext,{requestId:command(),sourceCalendarEventId:calendarId});assert.equal(again.archiveEventId,canonical.archiveEventId);assert.equal(again.event.status,'canceled')
 }finally{
  await Promise.all(created.map(path=>db.doc(path).delete()))
  const audits=await db.collection('auditEvents').where('actorUid','in',[uid,other]).get();await Promise.all(audits.docs.map(doc=>doc.ref.delete()))
 }
})
