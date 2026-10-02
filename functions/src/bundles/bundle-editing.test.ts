import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {getFirestore} from 'firebase-admin/firestore'
import {createMaterialBundle,updateMaterialBundle} from './material-bundles.js'
test('one save atomically updates metadata and file labels while preserving originals and ownership',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 const db=getFirestore(),uid='editor-'+randomUUID(),auth={uid,token:{}};
 await db.doc('users/'+uid).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
 const rights={source:'청년회',owner:'청년회',attribution:'청년회',redistribution:'view_only',consentBasis:'공유 허락',sensitiveDataReviewed:true,retention:'managed',reviewDueAtMs:Date.now()+86400000};
 const metadata={title:'원래 제목',description:'설명',visibility:'public',rights,eventId:null};
 const result=await createMaterialBundle.run({auth,data:{...metadata,requestId:randomUUID()}} as never),ref=db.doc('materialBundles/'+result.bundleId);
 const files={file_first:{fileId:'file_first',displayName:'원래 이름',originalName:'original.pptx',order:0,status:'ready',revision:1,storagePath:'keep-path',scanStatus:'clean'}};
 await ref.update({files});
 const input={...metadata,bundleId:result.bundleId,requestId:randomUUID(),title:'수정한 제목',fileEdits:[{fileId:'file_first',displayName:'발표 자료',order:0}]};
 await assert.rejects(updateMaterialBundle.run({auth,data:{...input,fileEdits:[{fileId:'file_missing',displayName:'없는 파일',order:0}]}} as never),(e:{code?:string})=>e.code==='not-found');assert.equal((await ref.get()).get('title'),'원래 제목');
 await updateMaterialBundle.run({auth,data:input} as never);await updateMaterialBundle.run({auth,data:input} as never);
 const changed=(await ref.get()).data()!;assert.equal(changed.title,'수정한 제목');assert.equal(changed.files.file_first.displayName,'발표 자료');assert.equal(changed.files.file_first.originalName,'original.pptx');assert.equal(changed.files.file_first.storagePath,'keep-path');assert.equal(changed.files.file_first.scanStatus,'clean');assert.equal(changed.ownerUid,uid);
 await assert.rejects(updateMaterialBundle.run({auth,data:{...input,title:'다른 제목'}} as never),(e:{code?:string})=>e.code==='already-exists');
 await assert.rejects(updateMaterialBundle.run({auth,data:{...input,requestId:randomUUID(),fileEdits:[...input.fileEdits,...input.fileEdits]}} as never),(e:{code?:string})=>e.code==='invalid-argument');
 await db.doc('users/other-'+uid).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
 await assert.rejects(updateMaterialBundle.run({auth:{uid:'other-'+uid,token:{role:'administrator'}},data:{...input,requestId:randomUUID()}} as never),(e:{code?:string})=>e.code==='permission-denied');
 await updateMaterialBundle.run({auth,data:{...metadata,bundleId:result.bundleId,requestId:randomUUID(),title:'이전 클라이언트'}} as never);assert.equal((await ref.get()).get('files.file_first.displayName'),'발표 자료');
 await ref.delete();await db.doc('users/'+uid).delete();await db.doc('users/other-'+uid).delete();
})
