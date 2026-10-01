async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', r => r.request().url().startsWith(base + '/') ? r.continue() : r.abort());
  await page.goto(base + '/contribute');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const audience = page.getByRole('combobox', { name: '누가 볼 수 있나요' });
  await audience.waitFor();
  check(await audience.inputValue() === '', 'new contribution has no default publication audience');
  check(await audience.evaluate(e => !e.closest('details')), 'audience is outside collapsed settings');
  await page.getByRole('textbox', { name: '제목', exact: true }).fill('합성 공개 범위 검사');
  await page.getByRole('textbox', { name: '내용 (필수)', exact: true }).fill('선택 전에는 공개되면 안 되는 내용');
  await page.getByRole('checkbox', { name: /공유할 권한/ }).check();
  await page.getByRole('button', { name: '게시하기', exact: true }).click();
  check(await page.evaluate(() => !window.__weaveTest.calls.some(c => c.name === 'createSubmission')), 'no creation request before explicit selection');
  await audience.selectOption('보류');
  await page.reload();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await audience.inputValue() === '보류', 'explicit private selection survives draft recovery');
  return { results, qualification: 'actual form with synthetic backend; no production publication' };
}
