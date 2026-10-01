// Synthetic callable regressions; these do not replace live/Firestore concurrency acceptance.
// Run after `npm --prefix functions run build`. No Firebase SDK or network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as ics from '../functions/lib/calendar/ics-service.js';
import * as instagram from '../functions/lib/calendar/event-instagram.js';

const source = readFileSync(new URL('../functions/src/calendar/external-calendar-functions.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness({ actorUid } = {}) {
  const records = new Map();
  if (!actorUid) records.set('calendarSources/synthetic-source', {status:'active', ownerUid:'synthetic-owner'});
  const removed = Symbol('delete');
  class Timestamp {
    constructor(date) { this.date = date; }
    static fromDate(date) { return new Timestamp(date); }
    toDate() { return this.date; }
  }
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const set = (ref, data, options) => {
    const next = options?.merge ? { ...records.get(ref.path), ...data } : { ...data };
    for (const key of Object.keys(next)) if (next[key] === removed) delete next[key];
    records.set(ref.path, next);
  };
  const snapshot = ref => ({id:ref.id,exists:records.has(ref.path),data:()=>records.get(ref.path),get:field=>records.get(ref.path)?.[field]});
  const db = {
    collection(name) {
      const query = (filters=[], maximum=Infinity) => ({
        where(field, operator, value) { assert.equal(operator,'=='); return query([...filters,[field,value]],maximum); },
        limit(value) { return query(filters,value); },
        async get() {
          const docs=[...records].filter(([path,value])=>path.startsWith(name+'/')&&filters.every(([field,expected])=>value[field]===expected)).slice(0,maximum).map(([path])=>snapshot({path,id:path.split('/')[1]}));
          return {empty:docs.length===0,size:docs.length,docs};
        },
        doc(id=randomUUID()) { return { path: `${name}/${id}`, id, async get(){return snapshot(this)}, async update(data) { set(this, data, { merge: true }); } }; },
      });
      return query();
    },
    async getAll(...references) { return references.map(ref => ({ exists: records.has(ref.path) })); },
    batch() {
      const writes = [];
      const creates = new Set();
      return {
        set(...args) { writes.push(args); },
        create(ref, data) {
          if (creates.has(ref.path)) throw Error('Duplicate create in synthetic batch');
          creates.add(ref.path);
          writes.push([ref, data]);
        },
        async commit() {
          for (const path of creates) if (records.has(path)) throw Error('Existing synthetic document');
          writes.forEach(args => set(...args));
        },
      };
    },
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({
        async get(ref) { return snapshot(ref); },
        set(...args) { writes.push(args); },
        create(ref,data) { if(records.has(ref.path)) throw Error('existing synthetic doc'); writes.push([ref,data]); },
        update(ref, data) { writes.push([ref, data, { merge: true }]); },
      });
      writes.forEach(args => set(...args));
      return result;
    },
  };
  const modules = {
    'node:crypto': { createHash, randomUUID },
    'firebase-admin/app': { getApps: () => [{}] },
    'firebase-admin/firestore': { getFirestore: () => db, Timestamp, FieldValue: { serverTimestamp: () => 'synthetic-server-time', delete:()=>removed } },
    'firebase-functions/v2/https': { HttpsError, onCall: (_options, handler) => handler },
    './ics-service.js': ics,
    './event-instagram.js': instagram,
    '../community/actor-policy.js': { requireActorPolicy: () => {
      if (!actorUid) throw Error('Out-of-scope actor path');
      return { uid: actorUid };
    } },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, URL, Buffer,
    require(name) { if (!Object.hasOwn(modules, name)) throw Error(`Forbidden dependency: ${name}`); return modules[name]; },
  }, { timeout: 1000 });
  return { api: exports, records };
}

const body = hour => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:synthetic-same-event',
  `DTSTART:20260920T${hour}0000Z`, `DTEND:20260920T${hour}3000Z`,
  'SUMMARY:Original title', 'DESCRIPTION:Original description', 'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n');
const input = hour => ({ sourceId: 'synthetic-source', feedUrl: 'https://example.test/events.ics', body: body(hour), now: new Date('2026-09-11T00:00:00Z'), source: { sourceType: 'ics', organizerName: 'Synthetic', region: 'Test', visibility: 'member_only' } });
const candidates = records => [...records.keys()].filter(key => key.startsWith('calendarImportCandidates/'));

const admin = { uid: 'synthetic-operator', token: {role:'administrator'} };
test('restored external source requires comparison and selected apply before republishing', async () => {
  for (const prior of ['canceled', 'deleted']) {
    const {api,records}=harness();
    await api.ingestCalendarIcs(input('10'));
    const candidateKey=candidates(records)[0], candidateId=candidateKey.split('/')[1];
    await api.reviewCalendarImportCandidate({auth:admin,data:{candidateId,decision:'publish',note:'self-authored test'}});
    const eventKey=`calendarEvents/${candidateId}`;
    records.set(candidateKey,{...records.get(candidateKey),sourceDispositionApplied:prior});
    records.set(eventKey,{...records.get(eventKey),status:prior==='deleted'?'unpublished':'published',eventState:'canceled',description:'Keep Weave correction'});
    await api.ingestCalendarIcs(input('10'));
    assert.equal(records.get(candidateKey).pendingSourceDisposition,'confirmed');
    assert.equal(records.get(eventKey).eventState,'canceled');
    const comparison=await api.getCalendarImportChange({auth:admin,data:{candidateId}});
    assert.ok(comparison.changes.some(change=>change.field==='eventState'));
    await api.applyCalendarImportChange({auth:admin,data:{candidateId,expectedSourceRevision:comparison.sourceRevision,expectedEventRevision:comparison.eventRevision,fields:['eventState']}});
    assert.equal(records.get(eventKey).eventState,'confirmed');
    assert.equal(records.get(eventKey).status,'published');
    assert.equal(records.get(eventKey).description,'Keep Weave correction');
    assert.equal(records.get(candidateKey).sourceDispositionApplied,null);
  }
});
async function publishedWithChange() {
  const h = harness();
  await h.api.ingestCalendarIcs(input('10'));
  const candidateId = candidates(h.records)[0].split('/')[1];
  await h.api.reviewCalendarImportCandidate({auth:admin,data:{candidateId,decision:'publish',note:'Synthetic test'}});
  const eventKey = `calendarEvents/${candidateId}`;
  h.records.set(eventKey,{...h.records.get(eventKey),description:'Weave correction',extraField:'keep'});
  await h.api.ingestCalendarIcs({...input('10'),body:body('10').replace('Original title','Changed title')});
  return {...h,candidateId,eventKey};
}

test('compare and selected apply preserve local edits and reject stale event revision', async () => {
  const {api,records,candidateId,eventKey}=await publishedWithChange();
  const comparison=await api.getCalendarImportChange({auth:admin,data:{candidateId}});
  assert.equal(comparison.changes.find(c=>c.field==='title').sourceValue,'Changed title');
  assert.equal(comparison.changes.find(c=>c.field==='description').currentValue,'Weave correction');
  const data={candidateId,expectedSourceRevision:comparison.sourceRevision,expectedEventRevision:comparison.eventRevision,fields:['title']};
  records.set(eventKey,{...records.get(eventKey),title:'Concurrent edit'});
  await assert.rejects(api.applyCalendarImportChange({auth:admin,data}),e=>e.code==='aborted');
  assert.equal(records.get(eventKey).title,'Concurrent edit');
  const refreshed=await api.getCalendarImportChange({auth:admin,data:{candidateId}});
  await api.applyCalendarImportChange({auth:admin,data:{...data,expectedEventRevision:refreshed.eventRevision}});
  assert.equal(records.get(eventKey).title,'Changed title');
  assert.equal(records.get(eventKey).description,'Weave correction');
  assert.equal(records.get(eventKey).extraField,'keep');
});

test('disconnect retains existing event and prevents late import/apply', async () => {
  const {api,records,candidateId,eventKey}=await publishedWithChange();
  const comparison=await api.getCalendarImportChange({auth:admin,data:{candidateId}});
  const before=records.get(eventKey);
  await api.disconnectCalendarSource({auth:admin,data:{sourceId:'synthetic-source'}});
  assert.deepEqual(records.get(eventKey),before);
  await assert.rejects(api.ingestCalendarIcs({...input('11'),expectedConnectionRevision:'legacy-active'}),e=>e.code==='aborted');
  await assert.rejects(api.applyCalendarImportChange({auth:admin,data:{candidateId,expectedSourceRevision:comparison.sourceRevision,expectedEventRevision:comparison.eventRevision,fields:['title']}}),e=>e.code==='failed-precondition');
  assert.deepEqual(records.get(eventKey),before);
  assert.equal((await api.getCalendarImportChange({auth:admin,data:{candidateId}})).sourceStatus,'disconnected');
});

test('comparison and apply reject non-operator access', async () => {
  const {api,candidateId}=await publishedWithChange();
  for(const name of ['getCalendarImportChange','applyCalendarImportChange']) {
    await assert.rejects(api[name]({auth:{uid:'ordinary',token:{}},data:{candidateId}}));
  }
});

test('time change adopts a single legacy candidate without orphaning its published event', async () => {
  const {api,records}=harness();
  await api.ingestCalendarIcs(input('10'));
  const original=candidates(records)[0];
  const legacyId=createHash('sha256').update('legacy-candidate').digest('hex').slice(0,40);
  const value={...records.get(original)};
  delete value.stableIdentity;
  records.delete(original);
  for(const key of [...records.keys()]) if(key.startsWith('calendarImportCandidateAliases/')) records.delete(key);
  records.set(`calendarImportCandidates/${legacyId}`,value);
  await api.reviewCalendarImportCandidate({auth:admin,data:{candidateId:legacyId,decision:'publish',note:'legacy test'}});
  await api.ingestCalendarIcs(input('11'));
  assert.deepEqual(candidates(records),[`calendarImportCandidates/${legacyId}`]);
  assert.ok(records.has(`calendarEvents/${legacyId}`));
  assert.equal(records.get(`calendarImportCandidates/${legacyId}`).sourceChangeStatus,'pending');
});

test('ambiguous legacy candidates require resolution instead of silent merging', async () => {
  const {api,records}=harness();
  await api.ingestCalendarIcs(input('10'));
  const original=candidates(records)[0],value={...records.get(original)};
  delete value.stableIdentity;
  records.delete(original);
  for(const key of [...records.keys()]) if(key.startsWith('calendarImportCandidateAliases/')) records.delete(key);
  for(const id of ['legacy-one','legacy-two']) records.set(`calendarImportCandidates/${id}`,{...value});
  const before=[...records.entries()];
  await assert.rejects(api.ingestCalendarIcs(input('11')),e=>e.code==='failed-precondition');
  assert.deepEqual([...records.entries()],before);
});

test('reimport preserves a published or rejected candidate status', async () => {
  for (const status of ['published', 'rejected']) {
    const { api, records } = harness();
    await api.ingestCalendarIcs(input('10'));
    const key = candidates(records)[0];
    records.set(key, { ...records.get(key), status });
    await api.ingestCalendarIcs(input('10'));
    assert.equal(candidates(records).length, 1);
    assert.equal(records.get(key).status, status);
  }
});

test('changing start time retains the same candidate identity', async () => {
  const { api, records } = harness();
  await api.ingestCalendarIcs(input('10'));
  const original = candidates(records)[0];
  await api.ingestCalendarIcs(input('11'));
  assert.equal(candidates(records).length, 1);
  assert.equal(records.has(original), true);
});

test('reimport cannot re-publish over a previously edited event', async () => {
  const { api, records } = harness();
  await api.ingestCalendarIcs(input('10'));
  const key = candidates(records)[0];
  const candidateId = key.split('/')[1];
  const request = { auth: { uid: 'synthetic-operator', token: { role: 'administrator' } }, data: { candidateId, decision: 'publish', note: 'Synthetic review' } };
  await api.reviewCalendarImportCandidate(request);
  const eventKey = `calendarEvents/${candidateId}`;
  records.set(eventKey, { ...records.get(eventKey), title: 'Edited in Weave', description: 'Local correction', localOnlyField: 'keep?' });
  await api.ingestCalendarIcs(input('10'));
  await assert.rejects(api.reviewCalendarImportCandidate(request));
  assert.equal(records.get(eventKey).title, 'Edited in Weave');
  assert.equal(records.get(eventKey).description, 'Local correction');
  assert.equal(records.get(eventKey).localOnlyField, 'keep?');
});

// Correct behavior assertions, separate from the three KNOWN GAP observations above.
test('Google mapping: actual callable writes different affiliations to both candidate and event records', async () => {
  const { api, records } = harness({ actorUid: 'synthetic-owner' });
  const startAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const endAt = new Date(Date.parse(startAt) + 3_600_000).toISOString();
  const data = { organizerName: '공통 교당', region: '전국', visibility: 'member_only', events: [
    { externalId: 'calendar:one', title: '첫 행사', organizerName: '서울교당', region: '서울', startAt, endAt },
    { externalId: 'calendar:two', title: '둘째 행사', organizerName: '부산교당', region: '부산', startAt, endAt },
  ] };
  const first = await api.submitSelectedGoogleCalendarEvents({ data });
  assert.equal(first.submitted, 2);
  for (const prefix of ['calendarImportCandidates/', 'calendarEvents/']) {
    const rows = [...records].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
    assert.deepEqual(rows.map(row => [row.organizerName, row.region]), [['서울교당', '서울'], ['부산교당', '부산']]);
    assert.ok(rows.every(row => row.visibility === 'member_only'));
  }
  const events = [...records].filter(([key]) => key.startsWith('calendarEvents/')).map(([, value]) => value);
  assert.equal(events[0].summary, '서울교당에서 공유한 일정이에요');
  assert.equal(events[1].summary, '부산교당에서 공유한 일정이에요');
  assert.ok(events.every(row => !Object.hasOwn(row, 'ownerUid') && !Object.hasOwn(row, 'externalFingerprint')));
  const repeated = await api.submitSelectedGoogleCalendarEvents({ data });
  assert.equal(repeated.submitted, 0);
  assert.equal(repeated.duplicates, 2);
  assert.equal(records.size, 4);
});

test('Google mapping: invalid affiliation fails only its row and valid rows stay retry-safe', async () => {
  const { api, records } = harness({ actorUid: 'synthetic-owner' });
  const startAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const endAt = new Date(Date.parse(startAt) + 3_600_000).toISOString();
  const request = { data: {
    organizerName: '기본 교당', region: '전국', visibility: 'public', events: [
      { externalId: 'one', title: '첫 행사', organizerName: '서울교당', startAt, endAt },
      { externalId: 'two', title: '둘째 행사', organizerName: ' ', startAt, endAt },
    ],
  } };
  const result = await api.submitSelectedGoogleCalendarEvents(request);
  assert.equal(result.submitted, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(Array.from(result.results, row => row.status), ['published', 'failed']);
  assert.equal(records.size, 2);
  const retry = await api.submitSelectedGoogleCalendarEvents(request);
  assert.equal(retry.submitted, 0);
  assert.equal(retry.duplicates, 1);
  assert.equal(retry.failed, 1);
  assert.equal(records.size, 2);
});
