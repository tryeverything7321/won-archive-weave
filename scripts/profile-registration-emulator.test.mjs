import test from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from '../functions/node_modules/firebase-admin/lib/firestore/index.js'
import { updateMyMemberProfile, getMyMemberProfile } from '../functions/lib/profile/member-profile.js'

const enabled = process.env.GCLOUD_PROJECT === 'demo-weave-rules' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:18080'

test('required registration, optional consent withdrawal and audit use one atomic save', { skip: !enabled }, async () => {
  const db = getFirestore()
  const uid = 'synthetic-registration-' + Date.now()
  const auth = { uid, token: {} }
  await db.collection('users').doc(uid).set({ connected: true, termsVersion: '2026-07-20', communityRulesVersion: '2026-07-20' })
  try {
    await assert.rejects(updateMyMemberProfile.run({ auth, data: { realName: '', organization: '소속 없음' } }))
    assert.equal((await db.collection('memberProfiles').doc(uid).get()).exists, false)
    await assert.rejects(updateMyMemberProfile.run({ auth, data: { realName: '시험', organization: '소속 없음', wonBuddhismMembership: 'joined' } }))
    await updateMyMemberProfile.run({ auth, data: { realName: '시험', organization: '소속 없음', ageBand: '20s', wonBuddhismMembership: 'joined', religionConsentVersion: '2026-10-01' } })
    const saved = (await db.collection('memberProfiles').doc(uid).get()).data()
    assert.ok(saved.religionConsentedAt)
    assert.equal((await db.collection('users').doc(uid).get()).get('requiredProfileVersion'), '2026-10-01')
    await updateMyMemberProfile.run({ auth, data: { realName: '시험', organization: '소속 없음' } })
    const after = await getMyMemberProfile.run({ auth })
    assert.equal(after.profile.wonBuddhismMembership, undefined)
    assert.equal(after.profile.ageBand, undefined)
    assert.equal((await db.collection('memberProfiles').doc(uid).get()).get('religionConsentedAt'), undefined)
    const audits = await db.collection('auditEvents').where('actorUid', '==', uid).get()
    assert.equal(audits.size, 2)
    assert.ok(audits.docs.some(d => d.get('religionConsentAction') === 'withdrawn'))
    for (const audit of audits.docs) {
      assert.equal(audit.get('realName'), undefined)
      assert.equal(audit.get('wonBuddhismMembership'), undefined)
      await audit.ref.delete()
    }
  } finally {
    await db.collection('memberProfiles').doc(uid).delete()
    await db.collection('users').doc(uid).delete()
  }
})

test('Google provisioning preserves prior consent and refuses another login provider', { skip: !enabled }, async () => {
  const { completeGoogleLogin } = await import('../functions/lib/auth/google-login.js')
  const db = getFirestore()
  const uid = 'synthetic-google-' + Date.now()
  const auth = { uid, token: { firebase: { sign_in_provider: 'google.com' } } }
  const ref = db.collection('users').doc(uid)
  try {
    await completeGoogleLogin.run({ auth, data: { role: 'administrator' } })
    assert.equal((await ref.get()).get('provider'), 'google')
    assert.equal((await ref.get()).get('role'), undefined)
    await ref.set({ termsVersion: 'test-version', pseudonym: '시험별명' }, { merge: true })
    await completeGoogleLogin.run({ auth, data: {} })
    assert.equal((await ref.get()).get('termsVersion'), 'test-version')
    assert.equal((await ref.get()).get('pseudonym'), '시험별명')
    await ref.set({ provider: 'naver' }, { merge: true })
    await assert.rejects(completeGoogleLogin.run({ auth, data: {} }))
    assert.equal((await ref.get()).get('provider'), 'naver')
  } finally {
    await ref.delete()
    const audits = await db.collection('auditEvents').where('uid', '==', uid).get()
    await Promise.all(audits.docs.map(d => d.ref.delete()))
  }
})
