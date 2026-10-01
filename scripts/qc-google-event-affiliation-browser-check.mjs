async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const check = (ok, label) => { if (!ok) throw Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/calendar/connect');
  await page.evaluate(() => Object.assign(window.__weaveTest, {
    authOutcome: 'success', googleStatus: 200,
    googleCalendars: [{ id: 'first', summary: '첫 캘린더', primary: true }, { id: 'second', summary: '다른 캘린더' }],
    googleEvents: [
      { id: 'one', summary: '서울 행사', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } },
      { id: 'two', summary: '부산 행사', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } },
    ],
  }));
  await page.getByRole('button', { name: 'Google Calendar 연결', exact: true }).click();
  await page.getByRole('button', { name: '일정 불러오기', exact: true }).click();
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  const first = page.locator('.google-calendar-event-affiliation').nth(0);
  const second = page.locator('.google-calendar-event-affiliation').nth(1);
  await first.getByRole('textbox', { name: '교당·주최', exact: true }).fill('서울교당');
  await first.getByRole('textbox', { name: '지역', exact: true }).fill('서울');
  await second.getByRole('textbox', { name: '교당·주최', exact: true }).fill('부산교당');
  await second.getByRole('textbox', { name: '지역', exact: true }).fill('부산');
  await page.getByRole('textbox', { name: '기본 교당·주최', exact: true }).fill('공통 교당');
  check(await first.getByRole('textbox', { name: '교당·주최', exact: true }).inputValue() === '서울교당', 'shared default does not overwrite individual mapping');
  await page.getByRole('textbox', { name: '기본 교당·주최', exact: true }).fill('');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `per-event mapping fits ${width}px`);
  }
  await page.locator('.google-calendar-share-fields').scrollIntoViewIfNeeded();
  await page.locator('.google-calendar-share-fields').screenshot({ path: 'output/playwright/google-event-affiliation-desktop.png' });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.locator('.google-calendar-share-fields').scrollIntoViewIfNeeded();
  await page.locator('.google-calendar-share-fields').screenshot({ path: 'output/playwright/google-event-affiliation-mobile.png' });
  await page.evaluate(() => {
    window.__weaveTest.callableResponses = {
      submitSelectedGoogleCalendarEvents: input => input.events.length === 2
        ? { status: 'partial_failure', submitted: 1, duplicates: 0, failed: 1, results: [{ index: 0, status: 'published' }, { index: 1, status: 'failed' }] }
        : { status: 'published', submitted: 1, duplicates: 0, failed: 0, results: [{ index: 0, status: 'published' }] },
    };
  });
  await page.getByRole('button', { name: '선택한 일정 올리기', exact: true }).click();
  await page.waitForFunction(() => window.__weaveTest.calls.some(call => call.name === 'submitSelectedGoogleCalendarEvents'));
  const payload = await page.evaluate(() => window.__weaveTest.calls.find(call => call.name === 'submitSelectedGoogleCalendarEvents').input);
  check(payload.events.length === 2, 'two events submitted without requiring a shared organizer');
  check(payload.events[0].organizerName === '서울교당' && payload.events[0].region === '서울', 'first event retains Seoul affiliation in request');
  check(payload.events[1].organizerName === '부산교당' && payload.events[1].region === '부산', 'second event retains Busan affiliation in request');
  await page.getByText('실패한 일정 1개만 다시 선택해 두었어요.', { exact: false }).waitFor();
  check(!(await page.getByRole('checkbox').nth(0).isChecked()) && await page.getByRole('checkbox').nth(1).isChecked(), 'only failed event remains selected');
  await page.getByRole('button', { name: '선택한 일정 올리기', exact: true }).click();
  await page.waitForFunction(() => window.__weaveTest.calls.filter(call => call.name === 'submitSelectedGoogleCalendarEvents').length === 2);
  const retry = await page.evaluate(() => window.__weaveTest.calls.filter(call => call.name === 'submitSelectedGoogleCalendarEvents')[1].input);
  check(retry.events.length === 1 && retry.events[0].organizerName === '부산교당', 'retry submits failed affiliation only');
  await page.getByRole('combobox', { name: '가져올 캘린더' }).selectOption('second');
  await page.getByRole('button', { name: '일정 불러오기', exact: true }).click();
  await page.getByRole('checkbox').nth(1).check();
  check(await page.locator('.google-calendar-event-affiliation').getByRole('textbox', { name: '교당·주최', exact: true }).inputValue() === '', 'same event ID in another calendar does not inherit previous affiliation');
  return { results, qualification: 'synthetic Google/auth/callable, actual UI and payload; no live registration' };
}
