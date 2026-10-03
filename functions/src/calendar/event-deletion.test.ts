import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { getFirestore } from 'firebase-admin/firestore'
import { deleteCalendarEvent, getCalendarEventManagement } from './event-deletion.js'
import { calendarImportReimportPlan } from './external-calendar-functions.js'
test('calendar deletion checks ownership, keeps source and audit, and rejects republishing imported items', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const db=getFirestore(),uid='delete-'+randomUUID(),other=uid+'-other',auth={uid,token:{}},admin={uid:other,token:{role:'administrator'}},paths:string[]=[];
 const put=async(path:string,data:object)=>{paths.push(path);await db.doc(path).set(data)};
 const invoke=<T>(fn:{run:(r:never)=>T},eventId:string,actor:unknown=auth,reason='')=>fn.run({auth:actor,data:{eventId,reason}} as never);
 try{
  for(const id of [uid,other])await put('users/'+id,{connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
  await put('calendarEvents/'+uid,{status:'published',title:'합성 행사'});
  await put('calendarImportCandidates/'+uid,{status:'published',ownerUid:uid,sourceType:'google'});
  assert.equal((await invoke(getCalendarEventManagement,uid)).canDelete,true);
  assert.equal((await invoke(getCalendarEventManagement,uid,{uid:other,token:{}})).canDelete,false);
  await assert.rejects(invoke(deleteCalendarEvent,uid,{uid:other,token:{}}),(e:{code?:string})=>e.code==='permission-denied');
  await assert.rejects(deleteCalendarEvent.run({data:{eventId:uid}} as never),(e:{code?:string})=>e.code==='unauthenticated');
  await invoke(deleteCalendarEvent,uid);assert.equal((await db.doc('calendarEvents/'+uid).get()).get('status'),'unpublished');
  const imported=(await db.doc('calendarImportCandidates/'+uid).get()).data()!;assert.equal(imported.status,'rejected');
  assert.equal((await invoke(deleteCalendarEvent,uid)).repeated,true);
  const legacy=uid+'-legacy';await put('calendarEvents/'+legacy,{status:'published'});
  await assert.rejects(invoke(deleteCalendarEvent,legacy,admin),(e:{code?:string})=>e.code==='invalid-argument');
  await invoke(deleteCalendarEvent,legacy,admin,'중복 일정 삭제');assert.equal((await db.doc('calendarEvents/'+legacy).get()).get('deletedFromListings'),true);
  const manual=uid+'-manual';await put('calendarEvents/'+manual,{status:'published'});await put('calendarEventSubmissions/'+manual,{status:'published',ownerUid:uid});
  await invoke(deleteCalendarEvent,manual,admin,'중복 등록');assert.equal((await db.doc('calendarEventSubmissions/'+manual).get()).get('operatorModeration.action'),'remove');
  const source=uid+'-source',feed=uid+'-feed';await put('calendarSources/'+source,{ownerUid:uid,status:'active'});await put('calendarEvents/'+feed,{status:'published'});await put('calendarImportCandidates/'+feed,{sourceId:source,status:'published'});await invoke(deleteCalendarEvent,feed);assert.equal((await db.doc('calendarSources/'+source).get()).get('status'),'active');
  const audit=await db.collection('auditEvents').where('targetId','==',uid).get();assert.equal(audit.size,1);
  const incoming={title:'다시 동기화',description:'',locationName:'',startAt:'2026-10-03T01:00:00.000Z',endAt:'2026-10-03T02:00:00.000Z',allDay:false,timeZone:'Asia/Seoul',organizerName:'검증',region:'서울',visibility:'public'};
  assert.equal(calendarImportReimportPlan(imported,incoming as never).status,'rejected');
 }finally{for(const id of [uid,uid+'-legacy',uid+'-manual',uid+'-feed']){const audit=await db.collection('auditEvents').where('targetId','==',id).get();await Promise.all(audit.docs.map(d=>d.ref.delete()));}await Promise.all(paths.map(path=>db.doc(path).delete()));}
});
