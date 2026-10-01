async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/profile');
  const bio = page.getByRole('textbox', { name: /^짧은 소개/ });
  const save = page.getByRole('button', { name: '내 정보 저장하기', exact: true });
  await bio.waitFor();
  await page.evaluate(() => {
    window.__weaveTest.callableResponses = {
      updateMyMemberProfile: input => new Promise(resolve => { window.__weaveTest.finishSave = () => resolve({ profile: input }); }),
    };
  });
  await bio.fill('서버에 보낸 소개');
  await save.click();
  await page.waitForFunction(() => typeof window.__weaveTest.finishSave === 'function');
  await bio.fill('응답 기다리면서 새로 쓴 소개');
  await page.evaluate(() => window.__weaveTest.finishSave());
  await save.waitFor();
  check(await bio.inputValue() === '응답 기다리면서 새로 쓴 소개', 'late profile success preserves newer text');
  await bio.fill('이전 계정 세대의 제출');
  await save.click();
  await page.evaluate(() => window.__weaveTest.switchUser('synthetic-b'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('synthetic-b'));
  await page.evaluate(() => window.__weaveTest.switchUser('synthetic-a'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('synthetic-a'));
  await page.evaluate(() => window.__weaveTest.finishSave());
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
  check(await bio.inputValue() === '합성 프로필 synthetic-a', 'A B A transition rejects previous A save result');
  check(await save.isEnabled(), 'obsolete profile save does not leave current account busy');
  return { results, qualification: 'actual form, synthetic delayed callable only' };
}
