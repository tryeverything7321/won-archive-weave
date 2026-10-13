import assert from 'node:assert/strict';
import test from 'node:test';
import {eventDateTimeRangeLabel} from './calendar-model.ts';
const event = {startAt:new Date('2026-10-31T05:00:00Z'),endAt:new Date('2026-10-31T08:00:00Z'),timeZone:'Asia/Seoul',allDay:false};
test('same day includes end time',()=>assert.match(eventDateTimeRangeLabel(event),/오후 2:00 ~ 오후 5:00/));
test('overnight includes end date',()=>assert.match(eventDateTimeRangeLabel({...event,endAt:new Date('2026-11-01T02:00:00Z')}),/11월 1일 · 오전 11:00/));
test('single all-day exclusive end does not add next day',()=>assert.doesNotMatch(eventDateTimeRangeLabel({...event,startAt:new Date('2026-10-30T15:00:00Z'),endAt:new Date('2026-10-31T15:00:00Z'),allDay:true}),/11월|~/));
test('multiday all-day ends on last included day',()=>assert.match(eventDateTimeRangeLabel({...event,startAt:new Date('2026-10-30T15:00:00Z'),endAt:new Date('2026-11-02T15:00:00Z'),allDay:true}),/11월 2일/));
