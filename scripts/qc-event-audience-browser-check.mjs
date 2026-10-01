async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', r => r.request().url().startsWith(base + '/') ? r.continue() : r.abort());
  await page.goto(base + '/calendar/new');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const audience = page.getByRole('combobox', { name: /^공개 범위/ });
  await audience.waitFor();
  check(await audience.inputValue() === '', 'new event has no selected publication audience');
  check(await audience.evaluate(e => !e.closest('details')), 'event audience is outside collapsed settings');
  check(await audience.getAttribute('required') !== null, 'event requires an explicit audience');
  await audience.selectOption('member_only');
  await page.reload();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await audience.inputValue() === 'member_only', 'explicit member audience survives event draft recovery');
  return { results, qualification: 'synthetic account and backend; no production registration' };
}
