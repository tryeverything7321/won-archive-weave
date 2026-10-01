async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/contribute');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const title = page.getByRole('textbox', { name: '제목', exact: true });
  const body = page.getByRole('textbox', { name: '내용 (필수)', exact: true });
  const owner = page.getByRole('textbox', { name: '만든 사람 또는 단체', exact: true });
  await title.fill('회의 기록 초안');
  await owner.fill('합성 청년회');
  await body.fill('# 회의록\n\n본문만 올릴 자료');
  await page.getByRole('link', { name: 'profile 검증 ·', exact: true }).click();
  await page.goBack();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await title.inputValue() === '회의 기록 초안' && await owner.inputValue() === '합성 청년회', 'contribution title and owner survive menu return');
  check(await body.inputValue() === '# 회의록\n\n본문만 올릴 자료', 'contribution Markdown survives menu return');
  await body.fill('새로고침 직전 추가 내용');
  await page.reload();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await body.inputValue() === '새로고침 직전 추가 내용', 'contribution latest text survives reload');
  await page.evaluate(() => window.__weaveTest.switchUser('synthetic-b'));
  await page.waitForFunction(() => document.querySelector('input[placeholder*="청년 정기훈련"]')?.value === '');
  check(await body.inputValue() === '', 'account change clears contribution text');
  return { results, qualification: 'actual contribution component with synthetic account; publication not tested' };
}
