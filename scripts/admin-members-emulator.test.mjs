import test from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore, Timestamp } from '../functions/node_modules/firebase-admin/lib/firestore/index.js'
import { getAuth } from '../functions/node_modules/firebase-admin/lib/auth/index.js'
import { listAdminMembers, getAdminMemberOverview, listAdminMemberActivity, getAdminMemberPrivateDetails } from '../functions/lib/operations/members.js'
const enabled = process.env.GCLOUD_PROJECT === 'demo-weave-rules' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:18080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:19099'
test('member list and timeline keep a filtered population, hide identity, and audit private access', {skip: !enabled}, async () => {
  const db = getFirestore(), authService = getAuth()
  const tag='synthetic-members-'+Date.now(), ids=[tag+'-a',tag+'-b']
  const reader={uid:tag+'-reader',token:{role:'administrator',memberRead:true}}
  const privateReader={...reader,token:{...reader.token,memberPrivateRead:true}}
  let firstId
  try {
    for(const uid of ids) {
      await authService.createUser({uid})
      await db.doc('users/'+uid).set({pseudonym:uid,connected:true,provider:'google',termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20',requiredProfileVersion:'2026-10-01'})
    }
    await db.doc('memberProfiles/'+ids[0]).set({realName:'합성 이름',organization:'합성 모임',ageBand:'20s',wonBuddhismMembership:'joined',religionConsentVersion:'2026-10-01'})
    await db.doc('submissions/'+tag).set({ownerUid:ids[0],title:'합성 자료',kind:'자료',status:'published',createdAt:Timestamp.now()})
    await assert.rejects(listAdminMembers.run({auth:{uid:reader.uid,token:{role:'administrator'}},data:{search:tag}}),e=>e.code==='permission-denied')
    const first=await listAdminMembers.run({auth:reader,data:{search:tag,provider:'google',limit:1}})
    assert.equal(first.items.length,1);assert.ok(first.nextCursor);assert.equal(first.summary.demographics,null)
    assert.equal(first.items[0].uid,undefined);assert.equal(first.items[0].realName,undefined)
    // Pseudonyms are deliberately visible; raw account IDs remain absent as fields.
    const second=await listAdminMembers.run({auth:reader,data:{search:tag,provider:'google',limit:1,cursor:first.nextCursor}})
    assert.notEqual(first.items[0].memberId,second.items[0].memberId);assert.equal(second.nextCursor,null)
    const all=await listAdminMembers.run({auth:privateReader,data:{search:tag,provider:'google'}})
    assert.equal(all.summary.demographics.populationCount,2)
    assert.equal(all.summary.demographics.membership.joined,1);assert.equal(all.summary.demographics.membership.unanswered,1)
    firstId=all.items.find(item=>item.pseudonym===ids[0]).memberId
    await assert.rejects(getAdminMemberPrivateDetails.run({auth:reader,data:{memberId:firstId,reason:'합성 확인'}}),e=>e.code==='permission-denied')
    await assert.rejects(getAdminMemberPrivateDetails.run({auth:privateReader,data:{memberId:firstId,reason:''}}),e=>e.code==='invalid-argument')
    const details=await getAdminMemberPrivateDetails.run({auth:privateReader,data:{memberId:firstId,reason:'합성 확인'}})
    assert.equal(details.details.realName,'합성 이름')
    const overview=await getAdminMemberOverview.run({auth:reader,data:{memberId:firstId,reason:'합성 확인'}})
    assert.equal(overview.member.activityCounts.submission,1)
    const timeline=await listAdminMemberActivity.run({auth:reader,data:{memberId:firstId,reason:'합성 확인'}})
    assert.ok(timeline.items.some(item=>item.kind==='submission'&&item.title==='합성 자료'))
    assert.ok(timeline.notCollected.includes('마지막 접속'))
    const audit=await db.collection('auditEvents').where('operatorUid','==',reader.uid).get()
    assert.ok(audit.docs.some(doc=>doc.get('type')==='members.private_viewed'&&doc.get('reason')==='합성 확인'))
    assert.ok(audit.docs.every(doc=>doc.get('realName')===undefined))
  } finally {
    for(const uid of ids) { await authService.deleteUser(uid).catch(()=>{});for(const collection of ['users','memberProfiles','adminMemberHandles']) await db.doc(collection+'/'+uid).delete() }
    await db.doc('submissions/'+tag).delete()
    const audit=await db.collection('auditEvents').where('operatorUid','==',reader.uid).get();await Promise.all(audit.docs.map(doc=>doc.ref.delete()))
  }
})
