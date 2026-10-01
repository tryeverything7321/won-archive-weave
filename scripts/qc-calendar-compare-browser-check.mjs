async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base + '/management');
  await page.evaluate(() => {
    const state = window.__weaveTest;
    state.callableResponses = {
      ...state.callableResponses,
      getCalendarImportChange: () => ({candidateId:'synthetic-candidate',sourceStatus:'active',sourceRevision:'source-v2',eventRevision:'weave-v3',changes:[
        {field:'title',label:'제목',currentValue:'위브에서 고친 제목',sourceValue:'원본의 새 제목'},
        {field:'description',label:'설명',currentValue:'직접 쓴 설명',sourceValue:'원본의 새 설명'}
      ]}),
      applyCalendarImportChange: () => ({status:'partially_applied',remainingChanges:1}),
    };
  });
  const region = page.getByRole('region', { name: '원본 변경 비교' });
  await region.getByRole('button', { name: '원본 변경 비교', exact: true }).click();
  await region.getByRole('checkbox', { name: '제목', exact: true }).waitFor();
  check(await region.getByRole('button', { name: '선택한 0개 변경 적용' }).isDisabled(), 'no change selected by default');
  check(await region.getByText('위브에서 고친 제목', {exact:true}).isVisible() && await region.getByText('원본의 새 제목',{exact:true}).isVisible(), 'current and original values both visible');
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:1000});
    await region.scrollIntoViewIfNeeded();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `comparison fits ${width}px`);
    await region.screenshot({path:`output/playwright/calendar-compare-${width}.png`});
  }
  await region.getByRole('checkbox', {name:'제목',exact:true}).check();
  await region.getByRole('button', {name:'선택한 1개 변경 적용'}).click();
  await region.getByText('선택한 변경을 적용했어요. 남은 변경은 다시 비교해 주세요.').waitFor();
  const call = await page.evaluate(() => window.__weaveTest.calls.find(call=>call.name==='applyCalendarImportChange'));
  check(JSON.stringify(call.input.fields)==='["title"]', 'only explicitly selected title sent');
  check(call.input.expectedSourceRevision==='source-v2' && call.input.expectedEventRevision==='weave-v3','both comparison revisions sent');
  await page.evaluate(() => {window.__weaveTest.callableResponses.applyCalendarImportChange=()=>{throw Error('synthetic conflict')};});
  await region.getByRole('button',{name:'원본 변경 비교',exact:true}).click();
  await region.getByRole('checkbox',{name:'설명',exact:true}).check();
  await region.getByRole('button',{name:'선택한 1개 변경 적용'}).click();
  await region.getByText('적용을 완료하지 못했어요. 원본이나 위브 내용이 바뀌었을 수 있으니 다시 비교해 주세요.').waitFor();
  check(await region.getByRole('checkbox').count()===0,'failed apply clears stale selection and requires recompare');
  await page.evaluate(() => {
    const old=window.__weaveTest.callableResponses.getCalendarImportChange;
    window.__weaveTest.callableResponses.getCalendarImportChange=()=>({...old(),sourceStatus:'disconnected'});
  });
  await region.getByRole('button',{name:'원본 변경 비교',exact:true}).click();
  await region.getByRole('checkbox',{name:'제목',exact:true}).waitFor();
  check(await region.getByRole('checkbox',{name:'제목',exact:true}).isDisabled(),'disconnected source is comparison only');
  for (const sourceValue of ['원본에서 취소', '원본에서 삭제', '원본에서 정상']) {
    await page.evaluate(sourceValue => {
      window.__weaveTest.calls=[];
      window.__weaveTest.callableResponses.getCalendarImportChange=()=>({candidateId:'synthetic-candidate',sourceStatus:'active',sourceRevision:'state-source',eventRevision:'state-event',changes:[{field:'eventState',label:'행사 상태',currentValue:'취소됨',sourceValue}]});
      window.__weaveTest.callableResponses.applyCalendarImportChange=()=>({status:'applied',remainingChanges:0});
    },sourceValue);
    await region.getByRole('button',{name:'원본 변경 비교',exact:true}).click();
    await region.getByRole('checkbox',{name:'행사 상태',exact:true}).waitFor();
    check(await region.getByText(sourceValue,{exact:true}).isVisible(), sourceValue+' 상태 비교 표시');
    await region.getByRole('checkbox',{name:'행사 상태',exact:true}).check();
    await region.getByRole('button',{name:'선택한 1개 변경 적용'}).click();
    await region.getByText('선택한 변경을 적용했어요. 남은 변경은 다시 비교해 주세요.').waitFor();
    check(await page.evaluate(()=>JSON.stringify(window.__weaveTest.calls.find(call=>call.name==='applyCalendarImportChange').input.fields)==='["eventState"]'),sourceValue+' 상태만 명시 적용');
  }
  return {results,qualification:'Synthetic callable with actual comparison UI. Not live or transaction/permission verification.'};
}
