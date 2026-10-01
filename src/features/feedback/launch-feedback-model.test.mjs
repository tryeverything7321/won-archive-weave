import assert from 'node:assert/strict';
import test from 'node:test';
import { isLaunchMember, launchNudgeReady, launchFeedbackBody, FEEDBACK_PREFIX } from './launch-feedback-model.ts';
test('only accounts created since the official opening qualify',()=>{
 const now=Date.parse('2026-10-01T02:00:00Z');
 assert.equal(isLaunchMember('2026-09-30T15:00:00Z',now),true);
 for(const value of [undefined,'invalid','2026-09-30T14:59:59Z','2027-01-01T00:00:00Z'])assert.equal(isLaunchMember(value,now),false);
});
test('waits for browsing and never interrupts editing',()=>{
 assert.equal(launchNudgeReady(59,2,false),false);
 assert.equal(launchNudgeReady(60,1,false),false);
 assert.equal(launchNudgeReady(60,2,false),true);
 assert.equal(launchNudgeReady(180,1,false),true);
 assert.equal(launchNudgeReady(180,4,true),false);
});
test('feedback marking preserves the draft and the server body limit',()=>{
 const body='사용하던 내용';assert.equal(launchFeedbackBody(body,false),body);
 assert.equal(launchFeedbackBody(body,true),FEEDBACK_PREFIX+body);
 assert.equal(launchFeedbackBody(FEEDBACK_PREFIX+body,true),FEEDBACK_PREFIX+body);
 assert.equal(launchFeedbackBody('x'.repeat(2000-FEEDBACK_PREFIX.length),true).length,2000);
});
