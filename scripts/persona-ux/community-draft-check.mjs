async (rootPage) => {
  const page=await rootPage.context().newPage();
  const base = 'http://127.0.0.1:4193';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/community');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button',{name:'이야기 남기기',exact:true}).click();
  const composer = page.locator('.community-composer textarea');
  await composer.waitFor();
  const body = '이동해도 남는 커뮤니티 초안\n\n- 한글 Markdown';
  await composer.fill(body);
  await page.getByRole('link', { name: '내 프로필', exact: true }).click();
  await page.goBack();
  await page.getByRole('button',{name:'이야기 남기기',exact:true}).click();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await composer.inputValue() === body, 'community article survives internal navigation');
  await composer.fill(body + '\n새 문장');
  await page.reload();
  await page.getByRole('button',{name:'이야기 남기기',exact:true}).click();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await composer.inputValue() === body + '\n새 문장', 'community article survives immediate reload');
  await page.evaluate(() => {
    window.__weaveTest.callableResponses = {
      createCommunityPost: () => new Promise(resolve => { window.__weaveTest.finishPost = () => resolve({ postId: 'synthetic-created' }); }),
    };
  });
  await page.getByRole('button', { name: '글 올리기', exact: true }).click();
  await page.waitForFunction(() => typeof window.__weaveTest.finishPost === 'function');
  await composer.fill('제출 뒤에도 계속 쓴 새 내용');
  await page.evaluate(() => window.__weaveTest.finishPost());
  await page.getByRole('button', { name: '글 올리기', exact: true }).waitFor();
  check(await composer.inputValue() === '제출 뒤에도 계속 쓴 새 내용', 'late community success preserves newer edits');
  await page.evaluate(() => { window.__weaveTest.callableResponses.createCommunityPost = async () => ({ postId: 'synthetic-success' }); });
  await page.getByRole('button', { name: '글 올리기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.community-composer textarea')?.value === '');
  await composer.fill('성공한 다음 글의 새 초안');
  await page.reload();
  await page.getByRole('button',{name:'이야기 남기기',exact:true}).click();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await composer.inputValue() === '성공한 다음 글의 새 초안', 'next community post autosaves after previous success');
  const before = await page.evaluate(() => window.__weaveTest.calls.filter(call => call.name === 'createCommunityPost').length);
  await page.evaluate(() => {
    window.__weaveTest.originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('weave:form-draft:')) throw new DOMException('synthetic quota', 'QuotaExceededError');
      return window.__weaveTest.originalStorageWrite.call(this, key, value);
    };
    window.__weaveTest.callableResponses = { createCommunityPost: async () => ({ postId: 'synthetic-without-local-storage' }) };
  });
  await page.getByRole('button', { name: '글 올리기', exact: true }).click();
  await page.waitForFunction(expected => window.__weaveTest.calls.filter(call => call.name === 'createCommunityPost').length > expected, before, { timeout: 2000 });
  check(true, 'local storage failure does not prohibit server publication');
  await page.evaluate(() => { Storage.prototype.setItem = window.__weaveTest.originalStorageWrite; });
  await page.evaluate(() => window.__weaveTest.switchUser('synthetic-b'));
  await page.waitForFunction(() => document.querySelector('.community-composer textarea')?.value === '');
  check(await page.getByRole('button', { name: '계속 작성', exact: true }).count() === 0, 'new account cannot restore previous account article');
  await composer.fill('다른 계정의 초안');
  await page.evaluate(() => window.__weaveTest.switchUser(null));
  await page.waitForFunction(() => !document.querySelector('.community-composer textarea'));
  check(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('weave:form-draft:')).length) === 0, 'community logout removes stored drafts');
  await page.close();
  return { results, qualification: 'actual community form with synthetic auth, no production writes' };
}
