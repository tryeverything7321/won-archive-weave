import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUpdateHistory,updateDay,updateTime,filterUpdates} from './update-history.ts';
const entry={id:'one',commit:'a'.repeat(40),committedAt:'2026-09-30T15:15:00Z',area:'자료 등록',title:'파일 올리기',details:['드래그앤드롭 지원'],status:'deployed'};
const feed={schemaVersion:1,repository:'tryeverything7321/won-archive-weave',generatedAt:'2026-10-01T01:00:00Z',entries:[entry]};
test('Korean day boundaries and feature/search/status filters match the displayed timeline',()=>{
 assert.equal(updateDay(entry.committedAt),'2026-10-01');assert.equal(updateTime(entry.committedAt),'00:15');
 assert.equal(filterUpdates([entry],'자료 등록','드래그','2026-10-01','deployed').length,1);
 assert.equal(filterUpdates([entry],'전체','','2026-09-30','all').length,0);
 assert.equal(filterUpdates([entry],'전체','','','development').length,0);
});
test('feed refuses foreign repositories, malformed links, duplicate ids and unsupported statuses',()=>{
 assert.equal(parseUpdateHistory(feed).entries.length,1);
 for(const value of [{...feed,repository:'other/repo'},{...feed,entries:[entry,entry]},{...feed,entries:[{...entry,commit:'javascript:bad'}]},{...feed,entries:[{...entry,status:'maybe'}]},{...feed,entries:[{...entry,committedAt:'invalid'}]}])assert.throws(()=>parseUpdateHistory(value));
});
