import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
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
