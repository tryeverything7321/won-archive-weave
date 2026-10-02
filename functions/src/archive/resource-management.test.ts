import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {getFirestore} from 'firebase-admin/firestore'
import {manageQcResources,withdrawArchiveResource} from './resource-management.js'

test('resource withdrawal is owner-only and QC cleanup is administrator-only, preserves originals and excludes normal titles', {skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const db=getFirestore(),tag='resource-'+randomUUID(),uid=tag,other=tag+'-other',auth={uid,token:{}};
 for(const name of [uid,other])await db.doc('users/'+name).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
 await db.doc('materialBundles/'+tag).set({ownerUid:uid,title:'정기훈련 자료',status:'active'});
 await assert.rejects(withdrawArchiveResource.run({auth:{uid:other,token:{}},data:{targetType:'bundle',targetId:tag}} as never),(e:{code?:string})=>e.code==='permission-denied');
 await withdrawArchiveResource.run({auth,data:{targetType:'bundle',targetId:tag}} as never);
 assert.equal((await db.doc('materialBundles/'+tag).get()).get('status'),'withdrawn');
 await db.doc('materials/'+tag).set({title:'QC '+tag,status:'published'});
 await db.doc('activities/'+tag).set({title:'QC '+tag,status:'published'});
 await db.doc('submissions/'+tag).set({title:'QC '+tag,status:'published'});
 await db.doc('materials/'+tag+'-normal').set({title:'회의록 '+tag,status:'published'});
 await assert.rejects(manageQcResources.run({auth,data:{remove:true}} as never),(e:{code?:string})=>e.code==='permission-denied');
 const admin={uid:'synthetic-operator',token:{role:'administrator'}};
 const before=await manageQcResources.run({auth:admin,data:{remove:false}} as never);
 assert.ok(before.items?.some(x=>x.id===tag));assert.ok(!before.items?.some(x=>x.id===tag+'-normal'));
 await manageQcResources.run({auth:admin,data:{remove:true}} as never);
 for(const path of ['materials/','activities/','submissions/'])assert.equal((await db.doc(path+tag).get()).get('status'),'withdrawn');
 assert.equal((await db.doc('materials/'+tag+'-normal').get()).get('status'),'published');
});
