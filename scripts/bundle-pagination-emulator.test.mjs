import test from 'node:test'
import assert from 'node:assert/strict'
import {getFirestore} from '../functions/node_modules/firebase-admin/lib/firestore/index.js'
import {listMyMaterialBundles} from '../functions/lib/bundles/material-bundles.js'
const enabled=process.env.GCLOUD_PROJECT==='demo-weave-rules'&&process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:18080'
test('owner pagination includes more than 100 bundles and equal timestamps exactly once',{skip:!enabled},async()=>{
 const db=getFirestore(),uid='synthetic-pagination-'+Date.now(),paths=['users/'+uid],time=Date.now()
 try {
  const batch=db.batch();batch.set(db.doc(paths[0]),{connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'})
  for(let i=0;i<105;i++) { const path='materialBundles/'+uid+'-'+String(i).padStart(3,'0');paths.push(path);batch.set(db.doc(path),{ownerUid:uid,title:'합성 자료 '+i,description:'',files:{},status:'active',visibility:'hold',rights:{redistribution:'download_allowed'},createdAtMs:time,updatedAtMs:time}) }
  await batch.commit()
  let cursor,ids=[]; const sizes=[]
  do { const result=await listMyMaterialBundles.run({auth:{uid,token:{}},data:{limit:50,...(cursor?{cursor}:{})}});sizes.push(result.items.length);ids.push(...result.items.map(item=>item.bundleId));cursor=result.nextCursor;assert.ok(sizes.length<=3) } while(cursor)
  assert.deepEqual(sizes,[50,50,5]);assert.equal(new Set(ids).size,105)
  await assert.rejects(listMyMaterialBundles.run({auth:{uid,token:{}},data:{cursor:'invalid'}}),e=>e.code==='invalid-argument')
 }finally{const batch=db.batch();for(const path of paths)batch.delete(db.doc(path));await batch.commit()}
})
