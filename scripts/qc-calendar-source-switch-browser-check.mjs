async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/calendar/connect');
  await page.getByRole('button', { name: '단체 공개 캘린더 연결', exact: true }).click();
  await page.getByRole('textbox', { name: '캘린더 이름', exact: true }).fill('합성 교당 일정');
  const select = value => page.locator(`input[name="sourceType"][value="${value}"]`).check();
  await select('timetree_link');
  await page.getByRole('textbox', { name: 'TimeTree 공개 캘린더 주소', exact: true }).fill('https://timetreeapp.com/public_calendars/synthetic');
  await select('ics');
  check(await page.getByRole('textbox', { name: '공개 iCal 주소', exact: true }).inputValue() === '', 'TimeTree URL is not carried into ICS');
  check(await page.getByRole('textbox', { name: '캘린더 이름', exact: true }).inputValue() === '합성 교당 일정', 'source switch preserves calendar name');
  await page.getByRole('textbox', { name: '공개 iCal 주소', exact: true }).fill('https://example.test/public.ics');
  await select('google_public_ics');
  check(await page.getByRole('textbox', { name: '공개 iCal 주소', exact: true }).inputValue() === '', 'generic ICS URL is not carried into Google');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `calendar source form has no horizontal overflow at ${width}`);
  }
  await select('timetree_link');
  await page.getByRole('textbox', { name: '운영 주체', exact: true }).fill('합성 청년회');
  await page.getByRole('textbox', { name: 'TimeTree 공개 캘린더 주소', exact: true }).fill('https://timetreeapp.com/public_calendars/synthetic');
  await page.evaluate(() => {
    window.__weaveTest.callableResponses = { submitCalendarSource: () => new Promise(resolve => { window.__weaveTest.finishSourceRequest = resolve; }) };
  });
  await page.getByRole('button', { name: '공개 캘린더 연결 요청', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.__weaveTest.finishSourceRequest));
  check(await page.locator('input[name="sourceType"][value="ics"]').isDisabled(), 'source type cannot change while its request is pending');
  await page.evaluate(() => window.__weaveTest.finishSourceRequest({ status: 'pending_review' }));
  const notice = page.locator('.calendar-connect-message');
  await notice.waitFor();
  check((await notice.innerText()).includes('링크를 연결') && !(await notice.innerText()).includes('일정을 가져'), 'TimeTree success describes a link rather than importing events');
  await select('ics');
  check(await notice.count() === 0, 'changing source clears the previous success notice');
  return { results, qualification: 'local rendered form with synthetic callable response, no live submission or public-scope change' };
}
