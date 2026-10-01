async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/calendar/new');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const title = page.getByRole('textbox', { name: '행사 이름', exact: true });
  await title.waitFor();
  const originalUrl = page.url();
  check(await page.evaluate(() => Boolean(new URL(location.href).searchParams.get('draft'))), 'create route has a durable draft identity');
  await title.fill('합성 행사 초안');
  await page.getByRole('textbox', { name: '주최', exact: true }).fill('합성 청년회');
  await page.getByRole('textbox', { name: '지역', exact: true }).fill('서울');
  await page.locator('a[href*="/calendar/connect"]').first().click();
  await page.getByRole('link', { name: '작성 중인 행사로 돌아가기' }).click();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(page.url() === originalUrl, 'Google detour returns to the exact draft identity');
  check(await title.inputValue() === '합성 행사 초안' && await page.getByRole('textbox', { name: '주최', exact: true }).inputValue() === '합성 청년회', 'event fields survive connect detour');
  await title.fill('새로고침 직전 행사 제목');
  await page.reload();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await title.inputValue() === '새로고침 직전 행사 제목', 'event latest edit survives reload');
  await page.evaluate(() => window.__weaveTest.switchUser('synthetic-b'));
  await page.waitForFunction(() => document.querySelector('.event-editor input')?.value === '');
  check(await title.inputValue() === '', 'account switch clears another owner event draft');
  return { results, qualification: 'synthetic account and local storage; upload/server persistence and provider consent are not tested' };
}
