import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
assert.equal(process.env.GCLOUD_PROJECT,'demo-weave-rules')
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080')
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'127.0.0.1:19199')
const require=createRequire(resolve(process.env.WEAVE_RULES_MODULE_ROOT,'package.json'))
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing')
const {uploadBytes,getBytes,ref,deleteObject}=require('firebase/storage')
let env
const uid='synthetic-bundle-rules-'+Date.now(), bundleId='synthetic-bundle', fileId='synthetic-file', name='1-sample.pdf'
const objectPath=`quarantined/${uid}/material-bundles/${bundleId}/${fileId}/${name}`
const metadata={contentType:'application/pdf',customMetadata:{reservationId:uid,requestId:'synthetic-request',bundleId,fileId,revision:'1',weaveSha256:'a'.repeat(64)}}
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-weave-rules',firestore:{host:'127.0.0.1',port:18080,rules:await readFile('firestore.rules','utf8')},storage:{host:'127.0.0.1',port:19199,rules:await readFile('storage.rules','utf8')}})
 await env.withSecurityRulesDisabled(async c=>{
  await c.firestore().doc('users/'+uid).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'})
  await c.firestore().doc('materialBundles/'+bundleId).set({ownerUid:uid,status:'draft',files:{[fileId]:{status:'upload_pending',revision:1,storagePath:objectPath}}})
  await c.firestore().doc('materialBundleUploadReservations/'+uid).set({ownerUid:uid,bundleId,requestId:'synthetic-request',status:'active',expiresAtMs:Date.now()+60000,files:{[name]:{fileId,revision:1,targetName:name,sizeBytes:3,contentType:'application/pdf',sha256:'a'.repeat(64)}}})
 })
})
after(async()=>{
 if(!env)return
 await env.withSecurityRulesDisabled(async c=>{
  for(const path of ['users/'+uid,'materialBundles/'+bundleId,'materialBundleUploadReservations/'+uid])await c.firestore().doc(path).delete()
  await deleteObject(ref(c.storage()._delegate,objectPath)).catch(()=>{})
 })
 await env.cleanup()
})
test('bundle reservation requires current revision, exact metadata, size, and owner; direct reads stay denied',async()=>{
 const storage=env.authenticatedContext(uid).storage()._delegate
 const object=ref(storage,objectPath),data=new Uint8Array([1,2,3])
 await assertFails(uploadBytes(object,new Uint8Array([1,2]),metadata))
 await assertFails(uploadBytes(object,data,{...metadata,customMetadata:{...metadata.customMetadata,revision:'2'}}))
 await assertFails(uploadBytes(ref(env.authenticatedContext('synthetic-other').storage()._delegate,objectPath),data,metadata))
 await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage()._delegate,objectPath),data,metadata))
 await env.withSecurityRulesDisabled(c=>c.firestore().doc('materialBundleUploadReservations/'+uid).update({expiresAtMs:Date.now()-1000}))
 await assertFails(uploadBytes(object,data,metadata))
 await env.withSecurityRulesDisabled(c=>c.firestore().doc('materialBundleUploadReservations/'+uid).update({expiresAtMs:Date.now()+60000}))
 await env.withSecurityRulesDisabled(c=>c.firestore().doc('materialBundles/'+bundleId).update({[`files.${fileId}.revision`]:2}))
 await assertFails(uploadBytes(object,data,metadata))
 await env.withSecurityRulesDisabled(c=>c.firestore().doc('materialBundles/'+bundleId).update({[`files.${fileId}.revision`]:1,status:'withdrawn'}))
 await assertFails(uploadBytes(object,data,metadata))
 await env.withSecurityRulesDisabled(c=>c.firestore().doc('materialBundles/'+bundleId).update({status:'active'}))
 await assertSucceeds(uploadBytes(object,data,metadata))
 await assertFails(getBytes(object))
 await assertFails(getBytes(ref(env.unauthenticatedContext().storage()._delegate,objectPath)))
 await assertFails(uploadBytes(object,data,metadata))
})


test('regular Naver, Kakao and Google members can prepare and upload six PPTX files without operator claims',async()=>{
 const serverRequire=createRequire(resolve('functions/package.json'));
 const adminDb=serverRequire('firebase-admin/firestore').getFirestore;
 const {createMaterialBundle,prepareMaterialBundleFiles,finalizeMaterialBundle}=await import('../functions/lib/bundles/material-bundles.js');
 const db=adminDb();
 const contentType='application/vnd.openxmlformats-officedocument.presentationml.presentation';
 for(const provider of ['naver','kakao','google']){
  const owner=provider+':synthetic-'+randomUUID(), requestId=randomUUID();
  const auth={uid:owner,token:{firebase:{sign_in_provider:provider==='google'?'google.com':'custom'}}};
  let bundle,prepared;
  const paths=[];
  try{
   await db.doc('users/'+owner).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
   bundle=await createMaterialBundle.run({auth,data:{requestId,title:'합성 여섯 단 발표 자료',description:'',visibility:'public',rights:{source:'합성 모임',owner:'합성 제작자',attribution:'합성 제작자',redistribution:'view_only',consentBasis:'합성 제작자의 공유 허락',sensitiveDataReviewed:true,retention:'managed',reviewDueAtMs:Date.now()+86400000}}});
   const data=new Uint8Array([1,2,3]),sha256=createHash('sha256').update(data).digest('hex');
   prepared=await prepareMaterialBundleFiles.run({auth,data:{bundleId:bundle.bundleId,requestId,files:Array.from({length:6},(_,i)=>({clientFileId:'synthetic-'+i,name:`${i+1}단 발표.pptx`,displayName:`${i+1}단 발표`,order:i,size:data.length,contentType,sha256}))}});
   assert.equal(prepared.files.length,6);
   const storage=env.authenticatedContext(owner,auth.token).storage()._delegate;
   for(const file of prepared.files){
    paths.push(file.storagePath);
    await assertSucceeds(uploadBytes(ref(storage,file.storagePath),data,{contentType,customMetadata:{reservationId:prepared.reservationId,requestId,bundleId:bundle.bundleId,fileId:file.fileId,revision:String(file.revision),weaveSha256:sha256}}));
    await assertFails(getBytes(ref(storage,file.storagePath)));
   }
   const result=await finalizeMaterialBundle.run({auth,data:{bundleId:bundle.bundleId,requestId:randomUUID()}});
   assert.equal(result.status,'active');
  }finally{
   await env.withSecurityRulesDisabled(async c=>{await Promise.all(paths.map(path=>deleteObject(ref(c.storage()._delegate,path)).catch(()=>{})))});
   if(bundle)await db.doc('materialBundles/'+bundle.bundleId).delete();
   if(prepared)await db.doc('materialBundleUploadReservations/'+prepared.reservationId).delete();
   for(const collection of ['materialBundleCommands','auditEvents']){const docs=await db.collection(collection).where('uid','==',owner).get();await Promise.all(docs.docs.map(doc=>doc.ref.delete()))}
   await db.doc('materialBundleUploadUsage/'+owner).delete();await db.doc('users/'+owner).delete();
  }
 }
});

test('bundle upload rule stays within Storage two-document lookup budget',async()=>{
 const rules=await readFile('storage.rules','utf8');
 const reservationFunction=rules.match(/function hasBundleUploadReservation[^]*?(?=\n    match)/)[0];
 assert.equal((reservationFunction.match(/firestore\.get\(/g)||[]).length,2);
 const match=rules.match(/match \/quarantined\/\{uid\}\/material-bundles[^]*?(?=\n    match)/)[0];
 assert.match(match,/signedIn\(\)/);
 assert.doesNotMatch(match,/isActiveMember\(|firestore\.(get|exists)\(/);
});
