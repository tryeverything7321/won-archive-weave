async (page) => {
  const origin = 'http://127.0.0.1:4193';
  const out = 'work/weave-ui-review/persona-research/evidence/screenshots';
  const results = [];
  const check = (name, ok, detail) => { results.push({name,status:ok?'PASS':'FAIL',detail}); if(!ok) throw new Error(name+' '+JSON.stringify(detail)); };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const [name,path] of [['home','/'],['resources','/resources'],['archive','/archive'],['calendar','/calendar?month=2026-10'],['event','/events/synthetic-event-0'],['contribute','/contribute?intent=material'],['event-create','/calendar/new'],['community','/community'],['profile','/profile?tab=activity']]) {
      await page.goto(origin+path); await page.locator('h1').first().waitFor(); await page.waitForTimeout(1300);
      const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
      check(name+' '+width+' overflow',size.scroll<=size.width,size);
      await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1440,height:900}); await page.goto(origin+'/');
  await page.getByRole('button',{name:'만들기',exact:true}).filter({visible:true}).click();
  check('create choices',await page.getByRole('navigation',{name:'만들 콘텐츠 선택'}).getByRole('link').count()===4);
  check('create first link focus',await page.getByRole('link',{name:/활동 기록 남기기 이미/}).evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Escape');check('create Escape focus',await page.getByRole('button',{name:'만들기',exact:true}).filter({visible:true}).evaluate(el=>el===document.activeElement));
  await page.goto(origin+'/community');
  check('community read first',!(await page.getByRole('textbox',{name:'작성할 이야기'}).isVisible()));
  await page.getByRole('button',{name:'이야기 남기기',exact:true}).click();
  await page.getByRole('textbox',{name:'작성할 이야기'}).fill('합성 작성 중 내용 보존 확인');
  await page.getByRole('button',{name:'작성 잠시 접기'}).click();
  await page.getByRole('button',{name:'이야기 남기기',exact:true}).click();
  check('community draft kept',await page.getByRole('textbox',{name:'작성할 이야기'}).inputValue()==='합성 작성 중 내용 보존 확인');
  await page.goto(origin+'/profile?tab=activity');
  await page.getByRole('button',{name:'행사 관리',exact:true}).click();
  check('profile event URL',page.url().includes('manage=events'));
  await page.getByRole('button',{name:'기록·자료 관리',exact:true}).click();
  check('profile panels hidden',await page.locator('#management-events').isHidden());
  await page.goto(origin+'/resources');
  await page.locator('input[type=search]').fill('찾을 수 없는 합성 문서');
  await page.waitForURL(url=>url.searchParams.get('q')==='찾을 수 없는 합성 문서');
  check('search URL',new URL(page.url()).searchParams.get('q')==='찾을 수 없는 합성 문서');
  await page.getByRole('button',{name:/초기화|조건 지우기/}).first().click();
  await page.waitForURL(url=>!url.searchParams.has('q'));
  check('search reset',!new URL(page.url()).searchParams.has('q'));
  await page.locator('summary').filter({hasText:'형식'}).last().click();
  await page.getByRole('img',{name:/현재 불러온 실제 자료/}).waitFor();
  check('chart text counterpart',await page.getByRole('list',{name:'자료 형식별 건수'}).count()===1);
  await page.screenshot({path:`${out}/resources-chart-1440.png`,fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/');
  check('reduced motion three paths',await page.getByRole('navigation',{name:'위브에서 시작할 일'}).getByRole('link').count()===3);
  return {synthetic:true,results};
}
