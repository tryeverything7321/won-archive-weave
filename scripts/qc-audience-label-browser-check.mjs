async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [path, value] of [['/contribute', '회원 전용'], ['/calendar/new', 'member_only'], ['/calendar/connect', 'member_only']]) {
    await page.goto(base + path);
    if (path === '/calendar/connect') await page.getByRole('button', { name: '단체 공개 캘린더 연결', exact: true }).click();
    const select = page.locator('select').filter({ has: page.locator('option', { hasText: '위브 로그인 이용자' }) }).first();
    await select.waitFor({ state: 'visible' });
    await select.selectOption(value);
    check(await select.inputValue() === value, `${path}: audience label preserves stored enum ${value}`);
    check((await select.locator('option:checked').textContent()).includes('위브 로그인 이용자'), `${path}: selected audience is explicit`);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await select.scrollIntoViewIfNeeded();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}: no overflow at ${width}px`);
    }
    if (path === '/calendar/new') {
      await page.screenshot({ path: 'output/playwright/audience-label-desktop.png' });
      await page.setViewportSize({ width: 390, height: 1000 });
      await select.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'output/playwright/audience-label-mobile.png' });
    }
  }
  return { results, qualification: 'Local synthetic auth and actual form UI; no submission, live permission or publication acceptance.' };
}
