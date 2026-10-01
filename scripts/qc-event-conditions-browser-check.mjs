async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', r => r.request().url().startsWith(base + '/') ? r.continue() : r.abort());
  await page.goto(base + '/calendar/new');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('textbox', { name: '행사 이름', exact: true }).fill('조건부 입력 합성 검사');
  await page.getByRole('textbox', { name: '주최', exact: true }).fill('합성 주최');
  await page.getByRole('textbox', { name: '지역', exact: true }).fill('서울');
  await page.getByLabel('하루 종일 이어지는 행사예요').check();
  await page.getByLabel('시작일', { exact: true }).fill('2026-10-01');
  await page.getByLabel('종료일 (이 날까지 포함)').fill('2026-10-01');
  check(await page.getByLabel('시작일', { exact: true }).getAttribute('type') === 'date' && await page.getByLabel('종료일 (이 날까지 포함)').getAttribute('type') === 'date', 'all-day event uses date-only start and end');
  await page.locator('.event-editor details summary').click();
  await page.getByRole('combobox', { name: /^신청 상태/ }).selectOption('open');
  await page.getByLabel('신청 링크', { exact: true }).fill('https://example.com/synthetic');
  await page.getByRole('combobox', { name: /^신청 상태/ }).selectOption('not_required');
  check(await page.getByLabel('신청 링크', { exact: true }).count() === 0 && await page.getByLabel('신청 마감', { exact: true }).count() === 0, 'no-registration hides both deadline and URL');
  await page.getByRole('combobox', { name: /^신청 상태/ }).selectOption('open');
  check(await page.getByLabel('신청 링크', { exact: true }).inputValue() === 'https://example.com/synthetic', 'toggle-back preserves unsubmitted registration draft');
  await page.getByRole('combobox', { name: /^신청 상태/ }).selectOption('not_required');
  return { results, qualification: 'actual event form with synthetic account; date/payload normalization separately unit tested' };
}
