async (root) => {
 const page=await root.context().newPage();const origin='http://127.0.0.1:4193';const results=[];
 const check=(condition,name,detail)=>{results.push({name,pass:Boolean(condition),detail});if(!condition)throw new Error(name+' '+JSON.stringify(detail));};
 await page.clock.install();
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin||['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.goto(origin+'/contribute');await page.locator('form.contribution-form').waitFor();
 await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('weave-launch-feedback-v1:synthetic-a');const s=window.__weaveTest;s.materials[0]={...s.materials[0],sourceMode:'text',type:'TEXT',description:'',owner:'합성 청년회',textContent:{schemaVersion:1,format:'markdown',body:'기존 본문'}};s.callableResponses={getMySubmissionDraft:async()=>({submission:{id:'synthetic-material-0',status:'revision_requested',sourceMode:'text',kind:'자료',title:s.materials[0].title,owner:'합성 청년회',visibility:'회원 전용',consentBasis:'만든 사람에게 허락받았어요',consentConfirmed:true,sensitiveDataReviewed:true,textContent:s.materials[0].textContent}}),updateSubmissionDraft:async input=>{s.materials[0]={...s.materials[0],title:input.submission.title,textContent:input.submission.textContent};return{};},submitSubmission:async()=>({status:'published'})};history.pushState({},'','/contribute?submissionId=synthetic-material-0');dispatchEvent(new PopStateEvent('popstate'));});
 await page.getByRole('button',{name:'수정 저장',exact:true}).waitFor();
 for(const width of [1440,984,390]){
  await page.setViewportSize({width,height:900});
  const controls=await page.locator('.contribution-form select').evaluateAll(els=>els.slice(-2).map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,font:getComputedStyle(el).fontSize}}));
  check(controls.every(c=>c.height>=48&&c.font==='16px'),'edit controls readable '+width,controls);
  check(Math.abs(controls[0].width-controls[1].width)<2,'edit select widths aligned '+width,controls);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'edit no horizontal overflow '+width);
  await page.addScriptTag({url:origin+'/node_modules/axe-core/axe.min.js'});const axe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));check(axe.violations.length===0,'edit axe '+width,axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));await page.locator('#contribution-rights').scrollIntoViewIfNeeded();await page.screenshot({path:`work/weave-ui-review/oct01-journeys/edit-sharing-${width}.png`});
 }
 check(!(await page.locator('.contribution-submit').innerText()).includes('공개 원문은'),'text edit does not promise source link');
 await page.getByRole('textbox',{name:/^제목/}).fill('수정 후 재조회 검증');await page.getByRole('textbox',{name:'내용 (필수)',exact:true}).fill('저장 후 확인할 본문');
 await page.getByRole('button',{name:'수정 저장',exact:true}).click();await page.waitForFunction(()=>window.__weaveTest.calls.some(c=>c.name==='submitSubmission'));
 check(await page.evaluate(()=>window.__weaveTest.calls.some(c=>c.name==='updateSubmissionDraft'&&c.input.submission.title==='수정 후 재조회 검증')),'edit saved chosen record');
 await page.evaluate(()=>{history.pushState({},'','/resources');dispatchEvent(new PopStateEvent('popstate'));});await page.getByRole('link',{name:'수정 후 재조회 검증',exact:true}).waitFor();
 check(!(await page.locator('.material-copy').first().innerText()).includes('회원이 등록한 자료'),'saved list omits synthetic description');
 await page.getByRole('link',{name:'수정 후 재조회 검증',exact:true}).click();await page.getByText('저장 후 확인할 본문',{exact:true}).waitFor();check(true,'saved material detail re-read');
 await page.goto(origin+'/community?compose=1&feedback=launch');await page.getByRole('region',{name:'위브 이용 피드백 작성'}).waitFor();
 await page.getByRole('textbox',{name:'작성할 이야기'}).fill('자료 수정 화면 간격이 개선됐어요');await page.getByRole('button',{name:'글 올리기',exact:true}).click();
 await page.waitForFunction(()=>window.__weaveTest.calls.some(c=>c.name==='createCommunityPost'));
 check(await page.evaluate(()=>window.__weaveTest.calls.find(c=>c.name==='createCommunityPost').input.body.startsWith('[위브 피드백]\n\n')),'feedback reaches existing community callable');
 await page.goto(origin+'/?upcomingCount=1');await page.waitForTimeout(300);
 await page.evaluate(()=>{const s=window.__weaveTest;s.calendarResponse=options=>new Promise(resolve=>setTimeout(()=>resolve({items:options.monthKey==='2026-10'?[{id:'slow-current',title:'먼저 표시되는 행사',summary:'',description:'',organizerName:'합성 모임',region:'서울',locationName:'검증 장소',startAt:new Date('2026-10-10T10:00:00+09:00'),endAt:new Date('2026-10-10T12:00:00+09:00'),allDay:false,timeZone:'Asia/Seoul',visibility:'public',eventState:'confirmed',sourceType:'manual',origin:'published'}]:[],nextCursor:null,hasMore:false}),options.monthKey==='2026-10'?30:1500));history.pushState({},'','/resources');dispatchEvent(new PopStateEvent('popstate'));});
 await page.waitForTimeout(100);await page.evaluate(()=>{history.pushState({},'','/');dispatchEvent(new PopStateEvent('popstate'));});
 await page.getByRole('link',{name:'먼저 표시되는 행사',exact:true}).waitFor({timeout:800});check(true,'home shows first event while later months still pending');
 await page.evaluate(()=>{const s=window.__weaveTest;s.user.metadata={creationTime:'2026-10-01T00:00:00Z'};s.listeners.forEach(f=>f(s.user));});
 await page.clock.runFor(59000);check(await page.getByRole('complementary',{name:'위브 오픈과 피드백 안내'}).count()===0,'new member is not interrupted immediately');
 await page.evaluate(()=>{history.pushState({},'','/resources');dispatchEvent(new PopStateEvent('popstate'));});await page.locator('main h1').waitFor();await page.clock.runFor(1000);
 await page.getByRole('complementary',{name:'위브 오픈과 피드백 안내'}).waitFor();check(true,'new member nudge after active minute and two routes');
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 const box=await page.getByRole('complementary',{name:'위브 오픈과 피드백 안내'}).boundingBox();check(box.x>=0&&box.x+box.width<=390&&box.y+box.height<760,'mobile nudge above dock',box);
 check(await page.getByRole('complementary',{name:'위브 오픈과 피드백 안내'}).evaluate(el=>getComputedStyle(el).animationName)==='none','reduced motion disables glitter');
 await page.clock.resume();await page.waitForTimeout(1300);await page.addScriptTag({url:origin+'/node_modules/axe-core/axe.min.js'});const nudgeAxe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));check(nudgeAxe.violations.length===0,'nudge axe',nudgeAxe.violations.map(v=>v.id));await page.screenshot({path:'work/weave-ui-review/oct01-journeys/launch-nudge-390.png'});
 await page.getByRole('link',{name:'피드백 남기기',exact:true}).click();await page.getByRole('region',{name:'위브 이용 피드백 작성'}).waitFor();check(true,'nudge leads to feedback composer');
 await page.clock.runFor(200000);check(await page.getByRole('complementary',{name:'위브 오픈과 피드백 안내'}).count()===0,'clicked nudge stays dismissed');
 await page.close();return {results,scope:'actual React with synthetic data/auth/callables; no production writes'};
}
