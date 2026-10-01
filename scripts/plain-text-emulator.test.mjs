import test from 'node:test';
import assert from 'node:assert/strict';
import { getFirestore } from '../functions/node_modules/firebase-admin/lib/firestore/index.js';
import { createSubmission, getMySubmissionDraft, submitSubmission } from '../functions/lib/uploads/submissions.js';
const enabled = process.env.GCLOUD_PROJECT === 'demo-weave-rules' && process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:18080';
test('plain text spacing survives create, edit lookup and publication', { skip: !enabled }, async () => {
 const db=getFirestore(),uid='synthetic-plain-'+Date.now(),auth={uid,token:{}};
 const textContent={schemaVersion:1,format:'plain',body:'\n  이름      역할\n  민규\t진행  \n# 기호 유지\n'};
 let id;
 try {
  await db.doc('users/'+uid).set({connected:true,termsVersion:'2026-07-20',communityRulesVersion:'2026-07-20'});
  const result=await createSubmission.run({auth,data:{sourceMode:'text',title:'합성 공백 보존',kind:'자료',source:'시험 작성',owner:'합성 작성자',visibility:'공개',consentConfirmed:true,attribution:'합성 작성자',redistribution:'view_only',consentBasis:'직접 작성',sensitiveDataReviewed:true,retention:'managed',textContent}});
  id=result.submissionId;
  assert.deepEqual((await getMySubmissionDraft.run({auth,data:{submissionId:id}})).submission.textContent,textContent);
  const published=await submitSubmission.run({auth,data:{submissionId:id}});
  assert.equal(published.status,'published');
  assert.deepEqual((await db.doc('materials/'+id).get()).get('textContent'),textContent);
 } finally {
  if(id){await db.doc('submissions/'+id).delete();await db.doc('materials/'+id).delete();}
  await db.doc('users/'+uid).delete();
  for(const field of ['uid','actorUid']) {const audit=await db.collection('auditEvents').where(field,'==',uid).get();await Promise.all(audit.docs.map(d=>d.ref.delete()));}
 }
});
