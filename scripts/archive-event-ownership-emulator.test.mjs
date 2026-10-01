import test from 'node:test'
import assert from 'node:assert/strict'
import {getFirestore,Timestamp} from '../functions/node_modules/firebase-admin/lib/firestore/index.js'
import {ensureArchiveEventContext,getEventArchiveOverview} from '../functions/lib/archive/events.js'
import {linkArchiveRelation,unlinkArchiveRelation} from '../functions/lib/archive/relations.js'
import {searchArchiveDiscovery} from '../functions/lib/archive/discovery.js'
const enabled=process.env.GCLOUD_PROJECT==='demo-weave-rules'&&process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:18080'
test('first contributor cannot capture calendar ownership or unlink another contributor; current source visibility wins',{skip:!enabled},async()=>{
 const db=getFirestore(),tag='synthetic-event-owner-'+Date.now(),first=tag+'-first',owner=tag+'-owner',paths=[]
 const set=async(path,value)=>{paths.push(path);await db.doc(path).set(value)}
 const invoke=(handler,data,uid=first)=>handler.run({data,auth:uid?{uid,token:{}}:undefined})
 let sequence=0;const command=()=>tag+'-'+(++sequence)
 try{
  for(const uid of [first,owner])await set('users/'+uid,{connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'})
  await set('calendarEvents/'+tag,{title:tag,status:'published',visibility:'public',startAt:Timestamp.fromMillis(Date.now()),endAt:Timestamp.fromMillis(Date.now()+3600000),region:tag})
  await set('calendarEventSubmissions/'+tag,{ownerUid:owner})
  const context=await invoke(ensureArchiveEventContext,{sourceCalendarEventId:tag,requestId:command()});paths.push('archiveEvents/'+context.archiveEventId)
  assert.equal((await db.doc(paths.at(-1)).get()).get('ownerUid'),owner)
  await set('materialBundles/'+tag,{ownerUid:owner,title:'소유자의 자료',description:'',files:{},rights:{redistribution:'download_allowed'},visibility:'public',status:'active',createdAtMs:Date.now(),updatedAtMs:Date.now()})
  const relation={archiveEventId:context.archiveEventId,targetType:'bundle',targetId:tag}
  const linked=await invoke(linkArchiveRelation,{...relation,requestId:command()},owner);paths.push('archiveRelations/'+linked.relationId)
  await assert.rejects(invoke(unlinkArchiveRelation,{...relation,requestId:command()}),e=>e.code==='permission-denied')
  await db.doc('calendarEvents/'+tag).update({visibility:'member_only'})
  assert.equal((await invoke(getEventArchiveOverview,{archiveEventId:context.archiveEventId},null)).archiveEvent,null)
  let search=await invoke(searchArchiveDiscovery,{region:tag},null);assert.ok(!search.items.some(i=>i.id===context.archiveEventId))
  await db.doc('calendarEvents/'+tag).update({status:'withdrawn'})
  assert.equal((await invoke(getEventArchiveOverview,{archiveEventId:context.archiveEventId},owner)).archiveEvent,null)
  await assert.rejects(invoke(linkArchiveRelation,{...relation,requestId:command()},owner),e=>e.code==='not-found')
 }finally{await Promise.all(paths.map(p=>db.doc(p).delete()));const logs=await db.collection('auditEvents').where('actorUid','in',[first,owner]).get();await Promise.all(logs.docs.map(d=>d.ref.delete()))}
})
