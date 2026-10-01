async (page) => {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  // Run through playwright-cli run-code --filename after starting the isolated preview.
  // Provider mocks are unavoidable here; assertions target actual rendered components.
  const results = [];
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(String(error)));
  page.on('console', message => {
    if (/Maximum update depth|Too many re-renders/.test(message.text())) runtimeErrors.push(message.text());
  });
  const check = (condition, label) => { if (!condition) throw new Error(label); results.push(label); };
  const base = 'http://127.0.0.1:4191';
  await page.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith(base + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + '/profile');
  const bio = page.getByRole('textbox', { name: /^짧은 소개/ });
  await bio.waitFor();
  await page.evaluate(() => { window.__weaveTest.photo = 'error'; window.__weaveTest.switchUser('synthetic-b'); });
  await page.getByRole('button', { name: '사진만 다시 불러오기' }).waitFor();
  check((await bio.inputValue()).includes('synthetic-b'), 'profile editable when photo fails');
  await bio.fill('수정 중인 소개');
  const countBefore = await page.evaluate(() => window.__weaveTest.calls.filter(c => c.name === 'getMyMemberProfile').length);
  await page.evaluate(() => { window.__weaveTest.photo = 'none'; });
  await page.getByRole('button', { name: '사진만 다시 불러오기' }).click();
  await page.waitForFunction(() => !document.body.textContent.includes('사진만 다시 불러오기'));
  check(await bio.inputValue() === '수정 중인 소개', 'photo retry preserves edited profile');
  check(await page.evaluate(() => window.__weaveTest.calls.filter(c => c.name === 'getMyMemberProfile').length) === countBefore, 'photo retry does not refetch profile');
  await page.evaluate(() => { window.__weaveTest.photoDelay = 2000; window.__weaveTest.switchUser('synthetic-slow-photo'); });
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('synthetic-slow-photo'));
  check(await bio.isEditable(), 'slow photo does not block core editor');
  await page.evaluate(() => { window.__weaveTest.profile = 'denied'; window.__weaveTest.photoDelay = 0; window.__weaveTest.switchUser('synthetic-denied'); });
  await page.waitForFunction(() => !document.querySelector('textarea'));
  check((await page.locator('main').innerText()).includes('권한'), 'core permission failure is not empty success');
  await page.evaluate(() => { window.__weaveTest.profile = 'ready'; window.__weaveTest.profileDelay = 700; window.__weaveTest.switchUser('synthetic-old'); });
  await page.waitForFunction(() => document.body.textContent.includes('불러오'));
  await page.evaluate(() => { window.__weaveTest.profileDelay = 0; window.__weaveTest.switchUser('synthetic-new'); });
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('synthetic-new'));
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 800)));
  check((await bio.inputValue()).includes('synthetic-new'), 'late previous-account profile ignored');
  await page.screenshot({ path: 'output/playwright/qc-20260911-profile-desktop.png', fullPage: true });

  await page.goto(base + '/google');
  const connect = page.getByRole('button', { name: 'Google Calendar 연결', exact: true });
  for (const [mode, expected] of [['popup_closed', '취소'], ['popup_failed_to_open', '팝업 차단'], ['access_denied', '읽기 권한']]) {
    await page.evaluate(mode => { window.__weaveTest.authOutcome = mode; }, mode);
    await connect.click();
    await page.waitForFunction(expected => document.querySelector('.google-calendar-notice')?.textContent.includes(expected), expected);
    check(await connect.isEnabled(), 'Google ' + mode + ' retry enabled');
    if (mode === 'popup_closed') check(await page.locator('.google-calendar-notice').getAttribute('role') === 'status', 'Google cancellation is not an error alert');
  }
  for (const [status, expected] of [[401, '만료'], ['network', '네트워크']]) {
    await page.evaluate(status => { window.__weaveTest.authOutcome = 'success'; window.__weaveTest.googleStatus = status; }, status);
    await connect.click();
    await page.waitForFunction(expected => document.querySelector('.google-calendar-notice')?.textContent.includes(expected), expected);
    check(await connect.isEnabled(), 'Google ' + status + ' recovers');
  }
  await page.evaluate(() => {
    Object.assign(window.__weaveTest, { authOutcome: 'success', googleStatus: 200,
      googleCalendars: [{id:'primary',summary:'기본',primary:true},{id:'secondary',summary:'청년 일정'}],
      googleEvents: [{id:'event-one',summary:'유지할 선택',start:{date:'2026-10-01'},end:{date:'2026-10-02'}}],
    });
  });
  await connect.click();
  await page.getByLabel('가져올 캘린더').selectOption('secondary');
  await page.getByRole('button', { name: '일정 불러오기', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByLabel('교당·주최', { exact: true }).fill('검증 청년회');
  await page.evaluate(() => { window.__weaveTest.googleStatus = 401; });
  await page.getByRole('button', { name: '일정 불러오기', exact: true }).click();
  await connect.waitFor();
  await page.evaluate(() => { window.__weaveTest.googleStatus = 200; });
  await connect.click();
  await page.getByLabel('가져올 캘린더').waitFor();
  check(await page.getByLabel('가져올 캘린더').inputValue() === 'secondary', '401 reconnect preserves non-primary source calendar');
  check(await page.getByRole('checkbox').isChecked(), '401 reconnect preserves selected event of same calendar');
  check(await page.getByLabel('교당·주최', { exact: true }).inputValue() === '검증 청년회', '401 reconnect preserves organizer input');
  await page.evaluate(() => { window.__weaveTest.googleStatus = 401; });
  await page.getByRole('button', { name: '일정 불러오기', exact: true }).click();
  await connect.waitFor();
  await page.evaluate(() => { window.__weaveTest.googleStatus = 200; window.__weaveTest.googleCalendars = [{id:'primary',summary:'기본',primary:true}]; });
  await connect.click();
  await page.getByLabel('가져올 캘린더').waitFor();
  check(await page.getByRole('checkbox').count() === 0, 'unavailable previous calendar clears stale event selection');
  await page.goto(base + '/google');
  await page.evaluate(() => { window.__weaveTest.authOutcome = 'pending'; });
  await connect.click();
  await page.evaluate(() => { window.__weaveTest.switchUser('synthetic-next'); window.__weaveTest.pendingGoogle.callback({ access_token: 'synthetic-late' }); });
  check(await page.getByRole('button', { name: '연결 해제' }).count() === 0, 'late Google token after account switch ignored');
  await page.evaluate(() => { window.google.accounts.oauth2.initTokenClient = () => undefined; });
  await connect.click();
  await page.waitForFunction(() => document.querySelector('.google-calendar-notice')?.textContent.includes('설정'));
  check(await connect.isEnabled(), 'Google client initialization failure shows configuration recovery');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/qc-20260911-google-mobile.png', fullPage: true });

  await page.goto(base + '/community');
  const composer = page.locator('.community-composer textarea');
  await composer.waitFor();
  const original = '한글 원문\n\n- Markdown 목록\n지우면 안 되는 내용';
  await composer.fill(original);
  const fixtureButton = page.getByRole('button', { name: '이 주제로 글쓰기' });
  await fixtureButton.first().click();
  check(await composer.inputValue() === original, 'fixture prompt preserves multiline body');
  check(await composer.evaluate(el => el === document.activeElement), 'fixture prompt restores textarea focus');
  await page.getByRole('searchbox').fill('일치하지않는합성검색어');
  await page.locator('.community-starters button').first().waitFor();
  for (const button of await page.locator('.community-starters button').all()) {
    await button.click();
    check(await composer.inputValue() === original, 'starter preserves body');
  }
  await composer.fill('');
  await page.locator('.community-starters button').last().click();
  check(await composer.inputValue() === '', 'empty body stays empty after starter');
  for (const width of [360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'community no horizontal overflow ' + width);
  }
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'output/playwright/qc-20260911-community-desktop.png', fullPage: true });
  await page.goto(base + '/calendar?month=2026-10&view=agenda&region=서울&organizer=서울+모임&q=합성');
  const eventLink = page.locator('[data-calendar-event-id="synthetic-event-6"]').first();
  await eventLink.waitFor();
  await eventLink.scrollIntoViewIfNeeded();
  const listUrl = page.url();
  const originalScroll = await page.evaluate(() => scrollY);
  await eventLink.click();
  await page.getByRole('button', { name: '행사 일정으로 돌아가기', exact: true }).waitFor();
  await page.evaluate(() => {
    window.__calendarTopResets = 0;
    const original = window.scrollTo.bind(window);
    window.scrollTo = (...args) => {
      if (location.pathname === '/calendar' && args[0]?.top === 0) window.__calendarTopResets++;
      return original(...args);
    };
    window.__weaveTest.eventsDelay = 150;
  });
  await page.getByRole('button', { name: '행사 일정으로 돌아가기', exact: true }).click();
  await eventLink.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-calendar-event-id') === 'synthetic-event-6');
  check(page.url() === listUrl, 'calendar detail return preserves month view region organizer query');
  check(await page.evaluate(() => window.__calendarTopResets) === 0, 'calendar return does not flash back to page top');
  check(Math.abs(await page.evaluate(() => scrollY) - originalScroll) < 3, 'calendar return restores scroll after delayed results');
  await page.reload();
  await eventLink.waitFor();
  check(page.url() === listUrl, 'calendar refresh preserves explicit filters');
  await eventLink.click();
  await page.getByRole('button', { name: '행사 일정으로 돌아가기', exact: true }).waitFor();
  await page.goBack();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-calendar-event-id') === 'synthetic-event-6');
  check(page.url() === listUrl, 'browser back restores calendar query and selected event focus');
  await eventLink.click();
  await page.getByRole('button', { name: '행사 일정으로 돌아가기', exact: true }).waitFor();
  await page.evaluate(() => { Object.assign(window.__weaveTest, { paginationFailure: true, calendarCalls: 0, eventsDelay: 30 }); });
  await page.goBack();
  await page.waitForFunction(() => window.__weaveTest.calendarCalls >= 2);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
  check(await page.evaluate(() => window.__weaveTest.calendarCalls) === 2, 'failed restore pagination stops automatic retry loop');
  await page.evaluate(() => { window.__weaveTest.paginationFailure = false; });
  await page.getByRole('button', { name: /다시/ }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-calendar-event-id') === 'synthetic-event-6');
  check(page.url() === listUrl, 'manual pagination retry restores selected event without losing filters');
  const calendarSearch = page.getByRole('searchbox');
  await calendarSearch.fill('합성 행사');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === '합성 행사');
  check(await calendarSearch.evaluate(el => el === document.activeElement), 'editing a calendar filter after return keeps input focus');
  await page.setViewportSize({ width: 390, height: 844 });
  check(page.url().includes('view=agenda'), 'calendar resize preserves chosen view');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'calendar mobile no horizontal overflow');
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'output/playwright/qc-20260911-calendar-mobile.png', fullPage: true });
  await eventLink.click();
  await page.getByRole('button', { name: '행사 일정으로 돌아가기', exact: true }).waitFor();
  await page.evaluate(() => { window.__weaveTest.deletedEventId = 'synthetic-event-6'; });
  await page.goBack();
  await page.waitForFunction(() => document.activeElement?.classList.contains('calendar-shell'));
  check(await page.locator('[data-calendar-event-id="synthetic-event-6"]').count() === 0, 'deleted selected item returns focus to calendar without stale event');
  check(page.url().includes('view=agenda') && page.url().includes('month=2026-10'), 'deleted selection fallback preserves exploration filters');
  await page.goto(base + '/events/synthetic-event-0');
  await page.getByRole('link', { name: '행사 일정으로 돌아가기', exact: true }).click();
  check(await page.evaluate(() => location.pathname) === '/calendar', 'direct event entry has safe list fallback');
  await page.goto(base + '/events/synthetic-missing');
  await page.getByRole('link', { name: '행사 일정으로 돌아가기', exact: true }).click();
  check(await page.evaluate(() => location.pathname) === '/calendar', 'missing event has safe list fallback');
  check(runtimeErrors.length === 0, `no uncaught exceptions or render loops: ${runtimeErrors.join('; ')}`);
  return { results, productionWrites: 0, qualification: 'local synthetic browser only' };
}
