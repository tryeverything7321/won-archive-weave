import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {getFirestore} from 'firebase-admin/firestore'
import {classifySubmissionAsMaterial} from './submission-classification.js'

test('meeting classification preserves old URL, visibility and references; only owner or operator can change published records', {skip:!process.env.FIRESTORE_EMULATOR_HOST}, async()=>{
 const db=getFirestore(), uid='classify-'+randomUUID(), id='meeting-'+randomUUID();
 await db.doc('users/'+uid).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
 await db.doc('users/other-'+uid).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
 const seed=async(status='published')=>{
 await db.doc('submissions/'+id).set({ownerUid:uid,kind:'활동 기록',status,visibility:'authenticated',eventId:'synthetic-event'});
 await db.doc('activities/'+id).set({status,visibility:'authenticated',title:'합성 회의록',eventId:'synthetic-event'});
 await db.doc('materials/'+id).set({status,visibility:'authenticated',title:'합성 회의록',kind:'활동 기록'});
 };
 await seed();
 const call=(auth:unknown)=>classifySubmissionAsMaterial.run({auth,data:{submissionId:id}} as never);
 await assert.rejects(call(undefined),(e:{code?:string})=>e.code==='unauthenticated');
 await assert.rejects(call({uid:'other-'+uid,token:{}}),(e:{code?:string})=>e.code==='permission-denied');
 const result=await call({uid,token:{}});
 assert.equal(result.href,'/materials/'+id);
 const record=await db.doc('activities/'+id).get();
 assert.equal(record.get('materialRedirectId'),id);
 assert.equal(record.get('visibility'),'authenticated');
 assert.equal(record.get('eventId'),'synthetic-event');
 assert.equal((await db.doc('submissions/'+id).get()).get('kind'),'자료');
 await call({uid,token:{}});
 assert.equal((await db.collection('auditEvents').where('submissionId','==',id).get()).size,1);
 await seed('withdrawn');
 await assert.rejects(call({uid:'operator',token:{role:'administrator'}}),(e:{code?:string})=>e.code==='failed-precondition');
 await seed();
 await call({uid:'operator',token:{role:'administrator'}});
 assert.equal((await db.doc('activities/'+id).get()).get('materialRedirectId'),id);
});
