async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (value, label) => { if (!value) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const canceled = { id:'synthetic-canceled', title:'합성 취소 행사', summary:'운영 데이터가 아닌 검증 행사', status:'canceled', contentPublished:true, startAt:'2026-10-01T01:00:00Z', endAt:'2026-10-01T03:00:00Z', createdAt:'2026-09-01T01:00:00Z', updatedAt:'2026-09-01T01:00:00Z', registrationDeadline:'', region:'서울', locationName:'검증 장소', createdByLabel:'검증 사용자', visibility:'member_only', gallery:[], mediaUploads:[] };
    window.__weaveTest = {
      user:{uid:'synthetic-a',getIdToken:async()=> 'synthetic-token',getIdTokenResult:async()=>({claims:{}})},listeners:[],calls:[],posts:[],
      switchUser(uid){this.user=uid?{uid}:null;this.listeners.forEach(f=>f(this.user))},
      callableResponses:{
        listMySubmissions:()=>({submissions:[{id:'synthetic-private',title:'합성 비공개 글',kind:'활동 기록',sourceMode:'text',visibility:'보류',status:'review_queued',scanStatus:'not_applicable',attachmentStatus:'pending',availableActions:['edit','withdraw']},{id:'synthetic-withdrawn',title:'합성 철회 글',kind:'활동 기록',sourceMode:'text',visibility:'보류',status:'withdrawn',scanStatus:'not_applicable',attachmentStatus:'pending',availableActions:['restore_private']}],limit:100,hasMore:false}),
        requestSubmissionChange:()=>({status:'draft',changeRequestId:'synthetic-change'}),
        listOwnedEvents:()=>({events:[{...canceled,reviewReason:'media_scan_pending'},
          {...canceled,id:'scan-blocked',title:'합성 검사 차단',status:'publishing_failed',reviewReason:'media_scan_blocked'},
          {...canceled,id:'scan-error',title:'합성 검사 오류',status:'publishing_failed',reviewReason:'automatic_media_scan_failed'}]}),
        unpublishOwnedEvent:()=>{canceled.status='unpublished';canceled.contentPublished=false;return {status:'unpublished'}}
      }
    };
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base + '/management');
  const textCard=page.locator('article').filter({has:page.getByRole('heading',{name:'합성 비공개 글'})});
  await textCard.getByRole('button',{name:/수정$/}).waitFor();
  check(!(await textCard.innerText()).match(/파일|사진|자동 확인 중/), 'private text has no attachment checking copy');
  check((await textCard.innerText()).includes('나만 보관'), 'private text describes storage');
  await textCard.getByRole('button',{name:/수정$/}).click();
  check(await page.evaluate(()=>window.__weaveTest.editedSubmission)==='synthetic-private','private text edit opens the selected record');
  const withdrawnCard=page.locator('article').filter({has:page.getByRole('heading',{name:'합성 철회 글'})});
  check(!(await withdrawnCard.innerText()).match(/첨부 파일을 확인|자동 확인 중/), 'withdrawn text has no pending attachment message');
  await withdrawnCard.getByRole('button',{name:'비공개 초안으로 복원',exact:true}).click();
  await page.waitForFunction(()=>window.__weaveTest.editedSubmission==='synthetic-withdrawn');
  check(await page.evaluate(()=>window.__weaveTest.calls.some(call=>call.name==='requestSubmissionChange'&&call.input.action==='restore_private'&&call.input.submissionId==='synthetic-withdrawn')), 'withdrawn restore dispatches private restore action and opens editor');
  const eventCard=page.locator('article').filter({has:page.getByRole('heading',{name:'합성 취소 행사'})});
  const blockedCard=page.locator('article').filter({has:page.getByRole('heading',{name:'합성 검사 차단'})});
  const errorCard=page.locator('article').filter({has:page.getByRole('heading',{name:'합성 검사 오류'})});
  check((await blockedCard.innerText()).includes('보안 검사를 통과하지 못'), 'blocked file explains security rejection');
  check((await errorCard.innerText()).includes('검사를 완료하지 못') && !(await errorCard.innerText()).includes('다시 올려'), 'scanner failure does not demand duplicate uploads');
  check(await eventCard.locator('.event-review-reason').count()===0,'canceled event has no stale scan notice');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'management desktop has no horizontal overflow');
  await eventCard.getByRole('button',{name:/수정$/}).click();
  check(await page.evaluate(()=>window.__weaveTest.editedEvent)==='synthetic-canceled','canceled event edit remains available');
  check(await eventCard.getByRole('button',{name:'행사 취소',exact:true}).count()===0,'canceled event has no duplicate cancel action');
  await page.evaluate(()=>{window.confirm=()=>true});
  await eventCard.getByRole('button',{name:/삭제$/}).click();
  await page.getByText('행사 공개를 중단했어요.',{exact:true}).waitFor();
  check(await eventCard.getByRole('button',{name:'비공개 초안으로 복원'}).count()===1 && await eventCard.locator('.owner-icon-action').count()===0,'unpublished event retains only private restoration');
  check(await eventCard.locator('.event-review-reason').count()===0,'unpublished event has no stale scan notice');
  check(await page.evaluate(()=>window.__weaveTest.calls.filter(c=>c.name==='unpublishOwnedEvent').length)===1,'unpublish issues one request');
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'management mobile has no horizontal overflow');
  await page.screenshot({path:'output/playwright/qc-20260911-management-mobile.png',fullPage:true});
  await page.evaluate(() => {
    const state=window.__weaveTest;
    const previous=state.callableResponses.listOwnedEvents;
    state.cachedEventResponse=previous();
    state.callableResponses.listOwnedEvents=()=>state.user?.uid==='slow-owner'
      ? new Promise(resolve=>{state.resolveOldEvents=()=>resolve(previous())}) : {events:[]};
    state.switchUser('slow-owner');
  });
  await page.waitForFunction(()=>typeof window.__weaveTest.resolveOldEvents==='function');
  await page.evaluate(()=>window.__weaveTest.switchUser('new-owner'));
  await page.getByRole('heading',{name:'아직 등록한 행사가 없어요',exact:true}).waitFor();
  await page.evaluate(()=>window.__weaveTest.resolveOldEvents());
  await page.waitForTimeout(100);
  check(await page.getByRole('heading',{name:'아직 등록한 행사가 없어요',exact:true}).count()===1,'late previous-account list cannot replace current owner events');
  await page.evaluate(() => {
    const state=window.__weaveTest;
    let attempts=0;
    state.callableResponses.listOwnedEvents=()=>state.user?.uid==='return-owner' && ++attempts===1
      ? new Promise(resolve=>{state.resolveFirstSession=()=>resolve(state.cachedEventResponse)}) : {events:[]};
    state.switchUser('return-owner');
  });
  await page.waitForFunction(()=>typeof window.__weaveTest.resolveFirstSession==='function');
  await page.evaluate(()=>window.__weaveTest.switchUser('middle-owner'));
  await page.getByRole('heading',{name:'아직 등록한 행사가 없어요',exact:true}).waitFor();
  await page.evaluate(()=>window.__weaveTest.switchUser('return-owner'));
  await page.getByRole('heading',{name:'아직 등록한 행사가 없어요',exact:true}).waitFor();
  await page.evaluate(()=>window.__weaveTest.resolveFirstSession());
  await page.waitForTimeout(100);
  check(await page.getByRole('heading',{name:'아직 등록한 행사가 없어요',exact:true}).count()===1,'A-B-A return ignores first A session response');
  for (const outcome of ['success','error']) {
    await page.evaluate(() => {
      const state=window.__weaveTest;
      state.callableResponses.listOwnedEvents=()=>state.user?.uid==='action-owner' ? state.cachedEventResponse : {events:[]};
      state.callableResponses.cancelOwnedEvent=()=>new Promise((resolve,reject)=>{
        state.finishCancel=()=>resolve({status:'canceled'});
        state.failCancel=()=>reject(new Error('synthetic delayed failure'));
      });
      state.switchUser('action-owner');
    });
    await blockedCard.getByRole('button',{name:'행사 취소',exact:true}).click();
    await page.waitForFunction(()=>typeof window.__weaveTest.finishCancel==='function');
    await page.evaluate(()=>window.__weaveTest.switchUser('after-action-owner'));
    await page.getByRole('heading',{name:'아직 등록한 행사가 없어요',exact:true}).waitFor();
    await page.evaluate(outcome=>outcome==='success' ? window.__weaveTest.finishCancel() : window.__weaveTest.failCancel(),outcome);
    await page.waitForTimeout(100);
    check(await page.locator('.event-manager-notice').count()===0,`late cancel ${outcome} cannot show previous-session notice`);
    check(await page.getByRole('heading',{name:'아직 등록한 행사가 없어요',exact:true}).count()===1,`late cancel ${outcome} preserves new account list`);
    await page.evaluate(()=>{delete window.__weaveTest.finishCancel;delete window.__weaveTest.failCancel});
  }
  return {results, qualification:'synthetic rendered UI only; not backend authorization, persistence or live QC'};
}
