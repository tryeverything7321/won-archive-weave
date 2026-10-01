async (page) => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base + '/contribute');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('textbox', { name: '제목', exact: true }).fill('합성 응답 유실 검사');
  await page.getByRole('textbox', { name: '만든 사람 또는 단체', exact: true }).fill('합성 청년회');
  const body = page.getByRole('textbox', { name: '내용 (필수)', exact: true });
  await body.fill('최초 요청의 본문');
  await page.getByRole('combobox', { name: '누가 볼 수 있나요' }).selectOption('공개');
  await page.getByRole('checkbox', { name: /공유할 권한/ }).check();
  await page.evaluate(() => {
    window.__weaveTest.callableResponses = { createSubmission: async () => { throw new Error('합성 응답 유실'); } };
  });
  await page.getByRole('button', { name: '게시하기', exact: true }).click();
  await page.getByText('합성 응답 유실', { exact: true }).waitFor();
  const first = await page.evaluate(() => window.__weaveTest.calls.find(call => call.name === 'createSubmission').input);
  check(Boolean(first.clientRequestId), 'first create attempt reserves request identity');
  await page.reload();
  await page.getByRole('button', { name: '계속 작성', exact: true }).click();
  check(await body.inputValue() === '최초 요청의 본문', 'failed creation preserves body across reload');
  await body.fill('복원 후 수정한 본문');
  await page.evaluate(() => {
    window.__weaveTest.callableResponses = {
      createSubmission: async () => ({ submissionId: 'synthetic-retry-submission' }),
      updateSubmissionDraft: async () => ({ submissionId: 'synthetic-retry-submission' }),
      submitSubmission: async () => ({ status: 'published' }),
    };
  });
  await page.getByRole('button', { name: '게시하기', exact: true }).click();
  await page.waitForFunction(() => window.__weaveTest.calls.some(call => call.name === 'submitSubmission'));
  const retry = await page.evaluate(() => window.__weaveTest.calls.find(call => call.name === 'createSubmission').input);
  check(JSON.stringify(retry) === JSON.stringify(first), 'reload retry keeps exact original create payload and id');
  const update = await page.evaluate(() => window.__weaveTest.calls.find(call => call.name === 'updateSubmissionDraft')?.input);
  check(Boolean(update) && JSON.stringify(update).includes('복원 후 수정한 본문'), 'new edits update recovered document after original create reconciliation');
  return { results, qualification: 'actual form retry with synthetic callables; no production or DB writes' };
}
