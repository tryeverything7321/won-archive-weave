async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', r => r.request().url().startsWith(base + '/') ? r.continue() : r.abort());
  await page.goto(base + '/archive');
  await page.getByRole('combobox', { name: '활동 형식' }).selectOption({ index: 1 });
  const activityType = await page.getByRole('combobox', { name: '활동 형식' }).inputValue();
  await page.locator('details summary').click();
  await page.locator('details').getByRole('link', { name: '기록 자세히 보기' }).first().click();
  await page.getByRole('link', { name: '활동 기록으로 돌아가기' }).click();
  check(await page.getByRole('combobox', { name: '활동 형식' }).inputValue() === activityType, 'archive activity filter survives back');
  check(await page.locator('details').evaluate(e => e.open), 'archive examples stay expanded');
  await page.reload();
  check(await page.getByRole('combobox', { name: '활동 형식' }).inputValue() === activityType, 'archive filter survives reload');
  await page.goto(base + '/resources');
  await page.getByRole('button', { name: 'PDF 문서만 보기', exact: true }).click();
  await page.locator('details summary').click();
  await page.locator('details a').first().click();
  await page.goBack();
  check(await page.getByRole('button', { name: 'PDF 문서만 보기', exact: true }).getAttribute('aria-pressed') === 'true', 'resource PDF filter survives back');
  check(await page.locator('details').evaluate(e => e.open), 'resource examples stay expanded');
  return { results, qualification: 'real list routes with synthetic external repository; not live user data' };
}
