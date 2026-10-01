async page => {
  const base = 'http://127.0.0.1:4191';
  const passed = [];
  const check = (value, label) => { if (!value) throw new Error(label); passed.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/community');
    const heading = page.locator('.community-fixture-board h3');
    await heading.waitFor();
    check(await heading.evaluate(e => getComputedStyle(e).color) === 'rgb(255, 255, 255)', width + ' community reverse title');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), width + ' community no overflow');
    await page.screenshot({ path: 'output/playwright/community-0916-' + width + '.png', fullPage: true });
    await page.goto(base + '/contribute');
    await page.locator('.contribution-submit p').waitFor();
    check(await page.locator('.contribution-submit p').evaluate(e => getComputedStyle(e).color) === 'rgb(255, 255, 255)', width + ' submit reverse copy');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), width + ' contribute no overflow');
    check(await page.locator('input[type=file]').first().getAttribute('accept') === '.txt,.md,text/plain,text/markdown', width + ' text import separate');
    await page.getByRole('radio', { name: '파일', exact: true }).check();
    const file = page.locator('.file-field input[type=file]').first();
    check((await file.getAttribute('accept')).includes('.hwp,.hwpx,.pdf,.docx'), width + ' attachment accepts documents');
    await file.evaluate(input => { const transfer = new DataTransfer(); transfer.items.add(new File(['%PDF-1.4\n%%EOF'], 'synthetic.pdf', { type: 'application/pdf' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
    check(await page.getByText('synthetic.pdf', { exact: true }).count() === 1, width + ' pdf selection accepted (not format rendering test)');
    await page.screenshot({ path: 'output/playwright/upload-0916-' + width + '.png', fullPage: true });
  }
  await page.goto(base + '/pdf-test');
  await page.getByRole('button', { name: '미리보기', exact: true }).waitFor();
  await page.evaluate(() => {
    window.__weaveTest.callableResponses = { createApprovedPreview: async () => ({ url: 'https://storage.googleapis.com/synthetic/preview.pdf', expiresAtMs: Date.now() + 300000 }) };
  });
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.locator('dialog iframe').waitFor();
  check(await page.locator('dialog').evaluate(e => e.open), 'preview opens in modal');
  check(await page.locator('dialog iframe').getAttribute('src') === 'https://storage.googleapis.com/synthetic/preview.pdf', 'authorized derivative URL only');
  await page.getByRole('button', { name: '미리보기 닫기' }).click();
  await page.locator('dialog iframe').waitFor({ state: 'detached' });
  check(await page.getByRole('button', { name: '미리보기', exact: true }).evaluate(e => e === document.activeElement), 'close restores trigger focus');
  check(await page.locator('iframe').count() === 0, 'close removes embedded document');
  await page.evaluate(() => {
    window.__weaveTest.callableResponses.createApprovedPreview = () => new Promise(resolve => { window.__resolvePreview = resolve; });
  });
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByText('미리보기를 준비하고 있어요.', { exact: false }).waitFor();
  await page.getByRole('button', { name: '미리보기 닫기' }).click();
  await page.evaluate(() => window.__resolvePreview({ url: 'https://storage.googleapis.com/synthetic/preview.pdf', expiresAtMs: Date.now() + 300000 }));
  check(await page.locator('iframe').count() === 0, 'late response after close ignored');
  await page.evaluate(() => { window.__weaveTest.callableResponses.createApprovedPreview = async () => { throw new Error('denied'); }; });
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByRole('alert').waitFor();
  check(await page.locator('iframe').count() === 0, 'denied preview never falls back to original');
  await page.getByRole('button', { name: '미리보기 닫기' }).click();
  for (const renderFormat of ['text', 'csv']) {
    await page.evaluate(format => {
      window.__weaveTest.callableResponses.createApprovedPreview = async () => ({ url: 'https://storage.googleapis.com/synthetic/source.' + format, expiresAtMs: Date.now() + 300000, renderFormat: format, text: '이름,내용\n위브,"쉼표,포함"\n문자,<script>window.__unsafe=1</script>', truncated: true });
    }, renderFormat);
    await page.getByRole('button', { name: '미리보기', exact: true }).click();
    await page.getByText('큰 파일이라 앞부분만 표시했어요. 전체 내용은 원본에서 확인하세요.').waitFor();
    check(renderFormat === 'text' ? (await page.locator('dialog pre').innerText()).includes('위브') : await page.locator('dialog td').count() === 6, renderFormat + ' readable content');
    check(await page.evaluate(() => window.__unsafe === undefined), renderFormat + ' HTML stays inert');
    await page.getByRole('button', { name: '미리보기 닫기' }).click();
    await page.locator('dialog pre, dialog table').waitFor({ state: 'detached' });
  }
  await page.route('https://storage.googleapis.com/synthetic/image.png', async route => route.fulfill({ response: await page.request.get(base + '/brand/wby-mark.png') }));
  await page.evaluate(() => { window.__weaveTest.callableResponses.createApprovedPreview = async () => ({ url: 'https://storage.googleapis.com/synthetic/image.png', expiresAtMs: Date.now() + 300000, renderFormat: 'image' }); });
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog img')?.naturalWidth > 0);
  check(true, 'image renderer decodes local PNG through synthetic authorized response');
  await page.getByRole('button', { name: '원본 크기로 보기' }).click();
  check(await page.locator('.approved-preview-image-wrap').evaluate(e => e.classList.contains('is-expanded')), 'image original size toggle');
  await page.evaluate(() => window.__weaveTest.switchUser(null));
  await page.locator('dialog img').waitFor({ state: 'detached' });
  check(await page.locator('dialog').evaluate(e => !e.open), 'signout removes preview');
  await page.evaluate(results => { window.__qcUploadPreview = { results, qualification: 'synthetic authorization/UI and local PNG only; remote PDF rendering, production and all-format conversion NOT_RUN' }; }, passed);
}
