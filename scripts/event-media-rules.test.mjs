import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Install test-only dependencies in an isolated directory; never use production credentials.
const moduleRoot = process.env.WEAVE_RULES_MODULE_ROOT;
assert.ok(moduleRoot, 'Set WEAVE_RULES_MODULE_ROOT to the isolated test dependency directory');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:19199');
// Aggregate tests use recorded synthetic verdicts, never an external scanner request.
process.env.FILE_SCANNER_ENDPOINT = 'https://scanner.invalid/emulator-only';
const require = createRequire(resolve(moduleRoot, 'package.json'));
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { getBytes, ref, listAll, uploadBytes } = require('firebase/storage');
const { collection, documentId, getDocs, getDocFromServer, doc, query, where } = require('firebase/firestore');
const { readAccessibleMaterial } = await import('../src/data/material-access.ts');
const appRoot = new URL('../', import.meta.url);
let env;
let adminApp;
let adminDb;
let events;
let submissions;
const serverRequire = createRequire(new URL('../functions/package.json', import.meta.url));
const operator = { uid: 'test-operator', token: { role: 'administrator' } };
const invoke = (handler, data, auth = operator) => handler.run({ data, auth });
const path = (visibility, id) => `approved/${visibility}/calendar-events/${id}/cover.jpg`;
const storage = context => context.storage()._delegate;
const read = (context, objectPath) => getBytes(ref(storage(context), objectPath));
const writeState = (id, status, visibility = 'public') => env.withSecurityRulesDisabled(context => context.firestore().doc(`calendarEvents/${id}`).set({ status, visibility }));

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-weave-rules',
    firestore: { host: '127.0.0.1', port: 18080, rules: await readFile(new URL('firestore.rules', appRoot), 'utf8') },
    storage: { host: '127.0.0.1', port: 19199, rules: await readFile(new URL('storage.rules', appRoot), 'utf8') },
  });
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('users/active').set({ connected: true, termsVersion: '2026-07-20', communityRulesVersion: '2026-07-20' });
    await context.firestore().doc('users/inactive').set({ connected: false, termsVersion: '2026-07-20', communityRulesVersion: '2026-07-20' });
    for (const objectPath of [path('public', 'public-event'), path('public', 'missing'), path('public', 'mismatch'), path('members', 'member-event'), 'approved/public/materials/example.pdf', 'approved/members/materials/example.pdf']) {
      await uploadBytes(ref(storage(context), objectPath), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
    }
  });
  await writeState('public-event', 'published');
  await writeState('mismatch', 'published', 'member_only');
  await writeState('member-event', 'published', 'member_only');
  const { initializeApp } = serverRequire('firebase-admin/app');
  adminApp = initializeApp({ projectId: 'demo-weave-rules', storageBucket: 'demo-weave-rules.appspot.com' });
  adminDb = serverRequire('firebase-admin/firestore').getFirestore(adminApp);
  events = await import(new URL('../functions/lib/calendar/event-management.js', import.meta.url));
  submissions = await import(new URL('../functions/lib/uploads/submissions.js', import.meta.url));
});
after(async () => {
  if (env) await env.cleanup();
  if (adminApp) await serverRequire('firebase-admin/app').deleteApp(adminApp);
});

test('text-only material create publish read edit hide restore and retry use real transactions', async () => {
  const auth = { uid: 'active', token: {} };
  const input = { sourceMode: 'text', title: '격리 회의록', kind: '자료', source: '직접 작성', owner: '테스트 청년회',
    visibility: '회원 전용', consentConfirmed: true, sensitiveDataReviewed: true,
    attribution: '테스트 청년회', consentBasis: '직접 작성', redistribution: 'view_only', retention: 'managed',
    textContent: { schemaVersion: 1, format: 'markdown', body: '# 회의록\n\n- 다음 모임 준비' } };
  const { submissionId } = await invoke(submissions.createSubmission, input, auth);
  await assert.rejects(invoke(submissions.updateSubmissionDraft, { submissionId, submission: input }, { uid: 'intruder', token: {} }));
  const request = { submissionId };
  assert.equal((await invoke(submissions.submitSubmission, request, auth)).status, 'published');
  assert.equal((await invoke(submissions.submitSubmission, request, auth)).status, 'published');
  const material = adminDb.doc(`materials/${submissionId}`);
  assert.equal((await material.get()).get('textContent.body'), input.textContent.body);
  assert.equal((await material.get()).get('approvedStoragePath'), undefined);
  await assertFails(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
  await assertSucceeds(env.authenticatedContext('active').firestore().doc(`materials/${submissionId}`).get());
  await invoke(submissions.requestSubmissionChange, { submissionId, action: 'request_revision' }, auth);
  const changed = { ...input, textContent: { ...input.textContent, body: '수정한 회의록' } };
  await invoke(submissions.updateSubmissionDraft, { submissionId, submission: changed }, auth);
  const draft = await invoke(submissions.getMySubmissionDraft, request, auth);
  assert.equal(draft.submission.textContent.body, '수정한 회의록');
  await invoke(submissions.submitSubmission, request, auth);
  assert.equal((await material.get()).get('textContent.body'), '수정한 회의록');
  await invoke(submissions.moderateSubmissionContent, { submissionId, action: 'hold', reason: '테스트 숨김 안내', requestId: 'text-hold-0001' });
  await assertFails(env.authenticatedContext('active').firestore().doc(`materials/${submissionId}`).get());
  await assert.rejects(invoke(submissions.submitSubmission, request, auth));
  await invoke(submissions.moderateSubmissionContent, { submissionId, action: 'restore', reason: '테스트 복구 안내', requestId: 'text-restore-0001' });
  assert.equal((await material.get()).get('visibility'), 'member_only');
  await assertFails(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
  await invoke(submissions.requestSubmissionChange, { submissionId, action: 'unpublish' }, auth);
  await assertFails(env.authenticatedContext('active').firestore().doc(`materials/${submissionId}`).get());
});

test('lost create acknowledgment reuses one owner-scoped draft and rejects changed payload replay', async () => {
  const auth = { uid: 'active', token: {} };
  const input = { clientRequestId: 'create-lost-ack-001', sourceMode: 'text', title: '응답 유실 초안', kind: '자료', source: '직접 작성', owner: '격리 청년회', visibility: '공개',
    consentConfirmed: true, sensitiveDataReviewed: true, attribution: '직접 작성', consentBasis: '직접 작성', redistribution: 'view_only', retention: 'managed',
    textContent: { schemaVersion: 1, format: 'markdown', body: '서버 저장 뒤 응답이 사라져도 같은 초안을 찾아요.' } };
  const [first, second] = await Promise.all([invoke(submissions.createSubmission, input, auth), invoke(submissions.createSubmission, input, auth)]);
  assert.equal(first.submissionId, second.submissionId);
  assert.equal((await invoke(submissions.createSubmission, input, auth)).submissionId, first.submissionId);
  await assert.rejects(invoke(submissions.createSubmission, { ...input, title: '다른 내용' }, auth));
  const drafts = await adminDb.collection('submissions').where('title', '==', input.title).get();
  assert.equal(drafts.size, 1);
});

test('public text activity projects a readable body and refuses file downloads', async () => {
  const auth = { uid: 'active', token: {} };
  const input = { sourceMode: 'text', title: '함께한 모임 기록', kind: '활동 기록', source: '직접 작성', owner: '테스트 청년회', visibility: '공개',
    consentConfirmed: true, sensitiveDataReviewed: true, attribution: '테스트', consentBasis: '직접 작성', redistribution: 'view_only', retention: 'managed',
    activity: { topic: '나와 마음', summary: '마음공부 모임', story: '함께 공부했어요' },
    textContent: { schemaVersion: 1, format: 'markdown', body: '## 모임 결과\n\n다음 달 다시 모이기로 했어요.' } };
  const { submissionId } = await invoke(submissions.createSubmission, input, auth);
  await invoke(submissions.submitSubmission, { submissionId }, auth);
  const activity = await assertSucceeds(env.unauthenticatedContext().firestore().doc(`activities/${submissionId}`).get());
  assert.equal(activity.get('textContent.body'), input.textContent.body);
  const downloads = await import(new URL('../functions/lib/uploads/downloads.js', import.meta.url));
  await assert.rejects(invoke(downloads.createApprovedDownload, { materialId: submissionId }, undefined));
});

test('one material can be reused without copying and is hidden everywhere when unpublished', async () => {
  const links = await import(new URL('../functions/lib/uploads/material-links.js', import.meta.url));
  const auth = { uid: 'active', token: {} };
  const base = { sourceMode: 'text', title: '재사용 검증 자료', kind: '자료', source: '직접 작성', owner: '격리 청년회', visibility: '회원 전용',
    consentConfirmed: true, sensitiveDataReviewed: true, attribution: '직접 작성', consentBasis: '직접 작성', redistribution: 'view_only', retention: 'managed',
    textContent: { schemaVersion: 1, format: 'markdown', body: '두 활동에서 같이 읽는 회의록' } };
  const create = async input => {
    const result = await invoke(submissions.createSubmission, input, auth);
    await invoke(submissions.submitSubmission, result, auth);
    return result.submissionId;
  };
  const materialId = await create(base);
  const activityIds = [];
  for (let i = 0; i < 2; i++) activityIds.push(await create({ ...base, title: `재사용 활동 ${i}`, kind: '활동 기록', visibility: '공개', activity: { topic: '나와 마음', summary: '함께 진행한 활동', story: '진행 결과를 공유해요' } }));
  for (const activityId of activityIds) {
    const command = { activityId, materialIds: [materialId], requestId: `reuse-${activityId}` };
    await invoke(links.setActivityMaterialLinks, command, auth);
    assert.equal((await invoke(links.setActivityMaterialLinks, command, auth)).repeated, true);
    await assert.rejects(invoke(links.setActivityMaterialLinks, { ...command, requestId: `unauthorized-${activityId}` }, { uid: 'intruder', token: {} }));
    const projection = (await adminDb.doc(`activities/${activityId}`).get()).data();
    assert.deepEqual(projection.linkedMaterialIds, [materialId]);
    assert.equal(projection.materialId, activityId, 'legacy attached material is preserved');
  }
  const impact = await invoke(links.getMaterialLinkImpact, { materialId }, auth);
  assert.equal(impact.linkedActivityCount, 2);
  assert.deepEqual(Object.keys(impact).sort(), ['hasMore', 'linkedActivityCount', 'materialId']);
  const memberQuery = query(collection(env.authenticatedContext('active').firestore()._delegate, 'materials'),
    where(documentId(), 'in', [materialId, activityIds[0]]), where('status', '==', 'published'), where('visibility', 'in', ['public', 'member_only']));
  assert.equal((await assertSucceeds(getDocs(memberQuery).catch(error => { error.message = `member linked query: ${error.message}`; throw error; }))).size, 2);
  const publicQuery = query(collection(env.unauthenticatedContext().firestore()._delegate, 'materials'),
    where(documentId(), 'in', [materialId, activityIds[0]]), where('status', '==', 'published'), where('visibility', '==', 'public'));
  // Regression: an ID batch containing an inaccessible link fails as a whole.
  await assertFails(getDocs(publicQuery));
  const readLinked = async context => (await Promise.all([materialId, activityIds[0]].map(id =>
    readAccessibleMaterial(() => getDocFromServer(doc(context.firestore()._delegate, 'materials', id))))))
    .filter(snapshot => snapshot?.exists()).map(snapshot => snapshot.id);
  assert.deepEqual(await readLinked(env.unauthenticatedContext()), [activityIds[0]]);
  assert.deepEqual(await readLinked(env.authenticatedContext('active')), [materialId, activityIds[0]]);
  await assertFails(env.unauthenticatedContext().firestore().doc(`materials/${materialId}`).get());
  await assertSucceeds(env.authenticatedContext('active').firestore().doc(`materials/${materialId}`).get());
  await invoke(links.setActivityMaterialLinks, { activityId: activityIds[0], materialIds: [], requestId: 'unlink-preserves-original' }, auth);
  assert.equal((await adminDb.doc(`materials/${materialId}`).get()).get('status'), 'published');
  await invoke(submissions.requestSubmissionChange, { submissionId: materialId, action: 'unpublish' }, auth);
  await assertFails(env.authenticatedContext('active').firestore().doc(`materials/${materialId}`).get());
  assert.deepEqual(await readLinked(env.authenticatedContext('active')), [activityIds[0]], 'hidden linked material is omitted without breaking public links');
  await assert.rejects(invoke(links.setActivityMaterialLinks, { activityId: activityIds[0], materialIds: [materialId], requestId: 'cannot-link-hidden-source' }, auth));
});

test('poster, presentation and body plus file publish metadata before attachment scan and deny downloads', async () => {
  const auth = { uid: 'active', token: {} };
  const downloads = await import(new URL('../functions/lib/uploads/downloads.js', import.meta.url));
  const base = { sourceMode: 'upload', title: '첨부 처리 검증', kind: '자료', source: '직접 작성', owner: '격리 청년회', visibility: '공개',
    consentConfirmed: true, sensitiveDataReviewed: true, attribution: '직접 작성', consentBasis: '직접 작성', redistribution: 'download_allowed', retention: 'managed' };
  for (const [name, contentType, body] of [
    ['poster.png', 'image/png', ''],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ''],
    ['minutes.txt', 'text/plain', '# 행사 결과\n\n파일 검사와 관계없이 읽는 본문'],
  ]) {
    const input = { ...base, ...(body ? { textContent: { schemaVersion: 1, format: 'markdown', body } } : {}) };
    const { submissionId } = await invoke(submissions.createSubmission, input, auth);
    await serverRequire('firebase-admin/storage').getStorage(adminApp).bucket()
      .file(`quarantined/active/${submissionId}/${name}`).save(Buffer.from([1, 2, 3]), { resumable: false, metadata: { contentType } });
    const result = await invoke(submissions.submitSubmission, { submissionId }, auth);
    assert.equal(result.status, 'published');
    const publicMaterial = await assertSucceeds(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
    assert.equal(publicMaterial.get('attachmentStatus'), 'pending');
    assert.equal(publicMaterial.get('approvedStoragePath'), undefined);
    assert.equal(publicMaterial.get('textContent.body') ?? '', body);
    await assert.rejects(invoke(downloads.createApprovedDownload, { materialId: submissionId }, undefined));
    assert.equal((await invoke(submissions.submitSubmission, { submissionId }, auth)).status, 'published');
    await invoke(submissions.requestSubmissionChange, { submissionId, action: 'request_revision' }, auth);
    // Editing keeps the previous public body readable until replacement is published.
    await assertSucceeds(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
    await invoke(submissions.updateSubmissionDraft, { submissionId, submission: { ...input, title: `수정한 ${name}` } }, auth);
    await invoke(submissions.submitSubmission, { submissionId }, auth);
    assert.equal((await adminDb.doc(`materials/${submissionId}`).get()).get('title'), `수정한 ${name}`);
    assert.equal((await adminDb.doc(`materials/${submissionId}`).get()).get('textContent.body') ?? '', body);
    // A stale path never overrides the independently blocked attachment state.
    await adminDb.doc(`materials/${submissionId}`).update({ attachmentStatus: 'blocked', approvedStoragePath: 'managed/stale.pdf' });
    await assert.rejects(invoke(downloads.createApprovedDownload, { materialId: submissionId }, undefined));
    await invoke(submissions.requestSubmissionChange, { submissionId, action: 'unpublish' }, auth);
    await assertFails(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
  }
});

test('real scan aggregate clean blocked error and late hidden outcomes preserve body and attachment isolation', async () => {
  const scanner = await import(new URL('../functions/lib/uploads/scanner-worker.js', import.meta.url));
  const bucket = serverRequire('firebase-admin/storage').getStorage(adminApp).bucket();
  const auth = { uid: 'active', token: {} };
  const body = '# 첨부와 분리된 활동 기록\n\n행사를 마치고 남긴 결과입니다.';
  const bytes = Buffer.from('Synthetic meeting notes for isolated transaction testing.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  for (const verdict of ['clean', 'blocked', 'error', 'hidden']) {
    const input = { sourceMode: 'upload', title: `첨부 전이 ${verdict}`, kind: '활동 기록', source: '직접 작성', owner: '격리 청년회', visibility: '공개',
      consentConfirmed: true, sensitiveDataReviewed: true, attribution: '직접 작성', consentBasis: '직접 작성', redistribution: 'download_allowed', retention: 'managed',
      activity: { topic: '나와 마음', summary: '행사 결과', story: '함께 남긴 기록' },
      textContent: { schemaVersion: 1, format: 'markdown', body } };
    const { submissionId } = await invoke(submissions.createSubmission, input, auth);
    const objectPath = `quarantined/active/${submissionId}/minutes.txt`;
    const file = bucket.file(objectPath);
    await file.save(bytes, { resumable: false, metadata: { contentType: 'text/plain', metadata: { weaveSha256: sha256 } } });
    const [metadata] = await file.getMetadata();
    const generation = String(metadata.generation);
    await invoke(submissions.submitSubmission, { submissionId }, auth);
    const materialRef = adminDb.doc(`materials/${submissionId}`);
    const activityRef = adminDb.doc(`activities/${submissionId}`);
    const createdAt = (await activityRef.get()).get('createdAt').toMillis();
    if (verdict === 'hidden') {
      await invoke(submissions.moderateSubmissionContent, { submissionId, action: 'hold', reason: '늦은 검사 결과 복원 방지', requestId: 'attachment-late-hidden' });
    }
    if (verdict === 'error') {
      await scanner.recordScannerFailure(submissionId, 'active', objectPath, 'wrong-generation', 'ignore_old_generation');
      assert.equal((await materialRef.get()).get('attachmentStatus'), 'pending');
      await scanner.recordScannerFailure(submissionId, 'active', objectPath, generation, 'scanner_unavailable:test');
    } else {
      const resultId = scanner.scanResultId(bucket.name, objectPath, generation);
      await adminDb.doc(`fileScanResults/${resultId}`).set({ schemaVersion: 1, verdict: verdict === 'blocked' ? 'blocked' : 'clean',
        provider: 'emulator-scanner', engineVersion: 'test-v1', scanId: resultId, bucket: bucket.name, path: objectPath,
        generation, size: Number(metadata.size), contentHash: `sha256:${sha256}`, scannedAtMs: Date.now() });
      await scanner.aggregateSubmissionScan(bucket.name, 'active', submissionId);
      await scanner.aggregateSubmissionScan(bucket.name, 'active', submissionId);
    }
    const material = await materialRef.get();
    const activity = await activityRef.get();
    assert.equal(material.get('textContent.body'), body);
    assert.equal(activity.get('createdAt').toMillis(), createdAt);
    if (verdict === 'hidden') {
      assert.notEqual(material.get('status'), 'published');
      assert.equal(material.get('approvedStoragePath'), undefined);
      await assertFails(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
    } else {
      assert.equal(material.get('status'), 'published');
      assert.equal(material.get('attachmentStatus'), verdict);
      assert.equal(activity.get('attachmentStatus'), verdict);
      await assertSucceeds(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
      if (verdict === 'clean') {
        assert.match(material.get('approvedStoragePath'), /^managed\//);
        assert.equal((await bucket.file(material.get('approvedStoragePath')).exists())[0], true);
      } else assert.equal(material.get('approvedStoragePath'), undefined);
    }
  }
});

test('lost upload acknowledgment reconciles actual bytes and replacing attachments keeps the same content identity', async () => {
  const selection = await import(new URL('../functions/lib/uploads/upload-selection.js', import.meta.url));
  const scanner = await import(new URL('../functions/lib/uploads/scanner-worker.js', import.meta.url));
  const bucket = serverRequire('firebase-admin/storage').getStorage(adminApp).bucket();
  const auth = { uid: 'active', token: {} };
  const input = { sourceMode: 'upload', title: '같은 글에서 파일 바꾸기', kind: '활동 기록', source: '직접 작성', owner: '격리 청년회', visibility: '공개',
    consentConfirmed: true, sensitiveDataReviewed: true, attribution: '직접 작성', consentBasis: '직접 작성', redistribution: 'download_allowed', retention: 'managed',
    activity: { topic: '나와 마음', summary: '교체 검증', story: '기록은 유지해요' },
    textContent: { schemaVersion: 1, format: 'markdown', body: '교체 중에도 유지되는 본문' } };
  const { submissionId } = await invoke(submissions.createSubmission, input, auth);
  let originalPath;
  for (const revision of [1, 2]) {
    if (revision === 2) {
      await invoke(submissions.requestSubmissionChange, { submissionId, action: 'request_revision' }, auth);
      await invoke(submissions.updateSubmissionDraft, { submissionId, submission: { ...input, title: '파일만 교체한 글' } }, auth);
      await adminDb.doc(`activities/${submissionId}`).update({ linkedMaterialIds: ['preserve-test-reference'] });
    }
    const bytes = Buffer.from(`회의록 버전 ${revision}`);
    const descriptor = { name: '회의록.txt', size: bytes.length, contentType: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex') };
    const command = { submissionId, requestId: `replace-upload-${revision}`, files: [descriptor] };
    await assert.rejects(invoke(selection.prepareSubmissionUploads, command, { uid: 'intruder', token: {} }));
    const prepared = await invoke(selection.prepareSubmissionUploads, command, auth);
    assert.deepEqual(await invoke(selection.prepareSubmissionUploads, command, auth), prepared);
    await assert.rejects(invoke(selection.prepareSubmissionUploads, { ...command, files: [{ ...descriptor, sha256: 'f'.repeat(64) }] }, auth));
    const targetName = prepared.files[0].targetName;
    const reconcile = { submissionId, requestId: command.requestId, targetName };
    assert.deepEqual(await invoke(selection.reconcileSubmissionUpload, reconcile, auth), { complete: false });
    const objectPath = `quarantined/active/${submissionId}/${targetName}`;
    await bucket.file(objectPath).save(bytes, { resumable: false, metadata: { contentType: descriptor.contentType } });
    // Simulate a stored object with its client completion acknowledgment lost.
    assert.deepEqual(await invoke(selection.reconcileSubmissionUpload, reconcile, auth), { complete: true });
    assert.deepEqual(await invoke(selection.reconcileSubmissionUpload, reconcile, auth), { complete: true });
    await assert.rejects(invoke(selection.reconcileSubmissionUpload, reconcile, { uid: 'intruder', token: {} }));
    await assert.rejects(invoke(selection.reconcileSubmissionUpload, { ...reconcile, targetName: '../other.txt' }, auth));
    await invoke(submissions.submitSubmission, { submissionId }, auth);
    const submitted = await adminDb.doc(`submissions/${submissionId}`).get();
    assert.equal(submitted.get('fileCount'), 1);
    assert.deepEqual(submitted.get('attachmentExpectedObjects').map((object) => object.path), [objectPath]);
    const material = await assertSucceeds(env.unauthenticatedContext().firestore().doc(`materials/${submissionId}`).get());
    assert.equal(material.get('textContent.body'), input.textContent.body);
    assert.equal(material.get('ownerUid'), undefined);
    assert.equal((await adminDb.doc(`activities/${submissionId}`).get()).get('ownerUid'), undefined);
    // Previous revision scan results must not attach a replacement before its own result exists.
    await scanner.aggregateSubmissionScan(bucket.name, 'active', submissionId);
    assert.equal((await adminDb.doc(`materials/${submissionId}`).get()).get('attachmentStatus'), 'pending');
    await bucket.file(objectPath).setMetadata({ metadata: { weaveSha256: descriptor.sha256 } });
    const [metadata] = await bucket.file(objectPath).getMetadata();
    const generation = String(metadata.generation);
    const resultId = scanner.scanResultId(bucket.name, objectPath, generation);
    await adminDb.doc(`fileScanResults/${resultId}`).set({ schemaVersion: 1, verdict: 'clean', provider: 'emulator-scanner', engineVersion: 'test-v1',
      scanId: resultId, bucket: bucket.name, path: objectPath, generation, size: bytes.length, contentHash: `sha256:${descriptor.sha256}`, scannedAtMs: Date.now() });
    await scanner.aggregateSubmissionScan(bucket.name, 'active', submissionId);
    const cleanMaterial = await adminDb.doc(`materials/${submissionId}`).get();
    assert.equal(cleanMaterial.get('attachmentStatus'), 'clean');
    const [approvedBytes] = await bucket.file(cleanMaterial.get('approvedStoragePath')).download();
    assert.deepEqual(approvedBytes, bytes);
    if (revision === 2) {
      assert.notEqual(objectPath, originalPath);
      assert.equal((await bucket.file(originalPath).exists())[0], true);
      assert.deepEqual((await adminDb.doc(`activities/${submissionId}`).get()).get('linkedMaterialIds'), ['preserve-test-reference']);
    }
    originalPath = objectPath;
  }
});

test('anonymous public photo follows published → hidden → restored event state', async () => {
  const guest = env.unauthenticatedContext();
  await assertSucceeds(read(guest, path('public', 'public-event')));
  await writeState('public-event', 'unpublished');
  await assertFails(read(guest, path('public', 'public-event')));
  await writeState('public-event', 'published');
  await assertSucceeds(read(guest, path('public', 'public-event')));
});
test('missing events and mismatched visibility deny anonymous photos', async () => {
  const guest = env.unauthenticatedContext();
  await assertFails(read(guest, path('public', 'missing')));
  await assertFails(read(guest, path('public', 'mismatch')));
});
test('member-only photos require active membership and deny everyone while hidden', async () => {
  await assertFails(read(env.unauthenticatedContext(), path('members', 'member-event')));
  await assertFails(read(env.authenticatedContext('inactive'), path('members', 'member-event')));
  await assertSucceeds(read(env.authenticatedContext('active'), path('members', 'member-event')));
  await writeState('member-event', 'unpublished', 'member_only');
  await assertFails(read(env.authenticatedContext('active'), path('members', 'member-event')));
  await writeState('member-event', 'published', 'member_only');
  await assertSucceeds(read(env.authenticatedContext('active'), path('members', 'member-event')));
  await assertFails(read(env.unauthenticatedContext(), path('members', 'member-event')));
});
test('event directory listing and client writes remain denied', async () => {
  const guest = env.unauthenticatedContext();
  await assertFails(listAll(ref(storage(guest), 'approved/public/calendar-events')));
  await assertFails(uploadBytes(ref(storage(env.authenticatedContext('active')), path('public', 'public-event')), new Uint8Array([4])));
});
test('non-event approved asset permissions are preserved', async () => {
  await assertSucceeds(read(env.unauthenticatedContext(), 'approved/public/materials/example.pdf'));
  await assertFails(read(env.unauthenticatedContext(), 'approved/members/materials/example.pdf'));
  await assertSucceeds(read(env.authenticatedContext('active'), 'approved/members/materials/example.pdf'));
});

test('event moderation handler updates actual Firestore and photo access with idempotent retry', async () => {
  const id = 'public-event';
  await adminDb.doc(`calendarEventSubmissions/${id}`).set({ status: 'published', ownerUid: 'test-owner' });
  await adminDb.doc(`calendarEvents/${id}`).set({ status: 'published', visibility: 'public', sourceType: 'manual' });
  const request = { eventId: id, action: 'hold', reason: '사진을 확인해 주세요', requestId: 'event_hold_001' };
  await assert.rejects(invoke(events.moderateManualEventContent, request, { uid: 'test-owner', token: {} }), { code: 'permission-denied' });
  const simultaneous = await Promise.all([invoke(events.moderateManualEventContent, request), invoke(events.moderateManualEventContent, request)]);
  assert.deepEqual(simultaneous.map(result => result.repeated).sort(), [false, true]);
  assert.equal((await adminDb.collection('auditEvents').where('requestId', '==', request.requestId).get()).size, 1);
  assert.equal((await adminDb.doc(`calendarEvents/${id}`).get()).get('status'), 'unpublished');
  await assertFails(read(env.unauthenticatedContext(), path('public', id)));
  assert.equal((await invoke(events.moderateManualEventContent, request)).repeated, true);
  await assert.rejects(invoke(events.moderateManualEventContent, { ...request, reason: '다른 사유입니다' }), { code: 'already-exists' });
  assert.equal((await adminDb.doc(`calendarEventSubmissions/${id}`).get()).get('moderationNotice.reason'), request.reason);
  await invoke(events.moderateManualEventContent, { ...request, action: 'restore', requestId: 'event_restore_001' });
  await assertSucceeds(read(env.unauthenticatedContext(), path('public', id)));
});

test('material handler requires prior guidance and preserves member-only activity through restore', async () => {
  const id = 'test-material';
  await adminDb.doc(`submissions/${id}`).set({ status: 'published', ownerUid: 'test-owner' });
  await adminDb.doc(`materials/${id}`).set({ status: 'published', visibility: 'member_only', approvedStorageObjects: [{ path: `managed/${id}/file.pdf`, generation: 'test-generation' }] });
  await adminDb.doc(`activities/${id}`).set({ status: 'published', visibility: 'member_only' });
  const request = { submissionId: id, action: 'remove', reason: '개인정보를 수정해 주세요', requestId: 'material_remove_001' };
  await assert.rejects(invoke(submissions.moderateSubmissionContent, request), { code: 'failed-precondition' });
  await assert.rejects(invoke(submissions.moderateSubmissionContent, request, { uid: 'test-owner', token: {} }), { code: 'permission-denied' });
  await invoke(submissions.moderateSubmissionContent, { ...request, action: 'warn', requestId: 'material_warn_001' });
  assert.equal((await adminDb.doc(`materials/${id}`).get()).get('status'), 'published');
  await invoke(submissions.moderateSubmissionContent, request);
  assert.equal((await invoke(submissions.moderateSubmissionContent, request)).repeated, true);
  assert.equal((await adminDb.doc(`activities/${id}`).get()).get('visibility'), 'hold');
  assert.equal((await adminDb.doc(`submissions/${id}`).get()).get('moderationGuidance'), undefined);
  await invoke(submissions.moderateSubmissionContent, { ...request, action: 'restore', requestId: 'material_restore_001' });
  assert.equal((await adminDb.doc(`activities/${id}`).get()).get('visibility'), 'member_only');
  assert.equal((await adminDb.doc(`submissions/${id}`).get()).get('operatorModeration'), undefined);
  await assert.rejects(invoke(submissions.moderateSubmissionContent, { ...request, requestId: 'material_remove_002' }), { code: 'failed-precondition' });
});

test('legacy event correction persists reason and replays after the queue is closed', async () => {
  const id = 'legacy-event';
  await adminDb.doc(`calendarEventSubmissions/${id}`).set({ status: 'review_queued', ownerUid: 'test-owner' });
  const request = { eventId: id, decision: 'reject', note: '행사 장소를 수정해 주세요', requestId: 'legacy_event_001' };
  await invoke(events.reviewManualEvent, request);
  await invoke(events.reviewManualEvent, request);
  const result = await adminDb.doc(`calendarEventSubmissions/${id}`).get();
  assert.equal(result.get('status'), 'draft');
  assert.equal(result.get('moderationNotice.reason'), request.note);
  assert.equal(result.get('moderationGuidance.reason'), request.note);
  await assert.rejects(invoke(events.reviewManualEvent, { ...request, note: '다른 안내입니다' }), { code: 'already-exists' });
});

test('legacy submission correction persists reason and replays after exception resolution', async () => {
  const id = 'legacy-submission';
  const exceptionId = 'legacy-exception';
  await adminDb.doc(`submissions/${id}`).set({ status: 'exception_queued', ownerUid: 'test-owner' });
  await adminDb.doc(`submissionOperatorExceptions/${exceptionId}`).set({ submissionId: id, status: 'open', type: 'automatic_publication_exception' });
  const request = { submissionId: id, exceptionId, action: 'request_revision', reason: '안전한 파일로 바꿔 주세요', requestId: 'legacy_submission_001' };
  await invoke(submissions.resolveSubmissionOperatorException, request);
  assert.equal((await adminDb.doc(`submissionOperatorExceptions/${exceptionId}`).get()).get('status'), 'resolved');
  await invoke(submissions.resolveSubmissionOperatorException, request);
  const result = await adminDb.doc(`submissions/${id}`).get();
  assert.equal(result.get('status'), 'revision_requested');
  assert.equal(result.get('moderationNotice.reason'), request.reason);
  assert.equal(result.get('moderationGuidance.reason'), request.reason);
  assert.equal((await adminDb.collection('auditEvents').where('requestId', '==', request.requestId).get()).size, 1);
  await assert.rejects(invoke(submissions.resolveSubmissionOperatorException, { ...request, reason: '다른 안내입니다' }), { code: 'already-exists' });
});
