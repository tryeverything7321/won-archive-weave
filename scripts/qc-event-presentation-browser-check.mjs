async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.unrouteAll();
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    external.push(url); return route.abort();
  });
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.goto(base + '/calendar?month=2026-09&view=agenda');
  const toggle = page.getByRole('checkbox', { name: '예시 보기' });
  await toggle.waitFor();
  check(!await toggle.isChecked(), 'examples excluded by default');
  await toggle.check();
  await page.getByRole('button', { name: '다음 달 보기', exact: true }).click();
  check(await page.evaluate(() => new URL(location.href).searchParams.get('examples') === '1'), 'example choice survives month navigation');
  await page.reload();
  check(await toggle.isChecked(), 'example choice survives reload');
  await page.locator('[data-calendar-event-id="synthetic-event-0"]').first().click();
  await page.getByRole('button', { name: '행사 일정으로 돌아가기', exact: true }).click();
  check(await toggle.isChecked(), 'example choice survives detail return');
  await page.evaluate(() => {
    window.__weaveTest.eventExtras = {
      thumbnail: { url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><rect width="400" height="900" fill="skyblue"/><text x="20" y="60">Poster</text></svg>'), alt: '합성 세로 포스터' },
      instagramPosts: [{ sourceUrl: 'https://www.instagram.com/p/ABCDE/', mediaType: 'post', shortcode: 'ABCDE' }],
    };
  });
  await page.locator('[data-calendar-event-id="synthetic-event-0"]').first().click();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const image = page.getByRole('img', { name: '합성 세로 포스터', exact: true }).first();
    await image.waitFor();
    check(await image.evaluate(e => getComputedStyle(e).objectFit === 'contain') && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `poster is contained without overflow at ${width}`);
  }
  const expand = page.getByRole('button', { name: '합성 세로 포스터 크게 보기' });
  await expand.click();
  check(await page.getByRole('dialog').isVisible(), 'poster expands in modal');
  await page.keyboard.press('Escape');
  check(await expand.evaluate(e => e === document.activeElement), 'escape closes and restores image trigger focus');
  check(!external.some(url => url.includes('instagram.com')), 'no Instagram request before activation');
  await page.getByRole('button', { name: 'Instagram 게시물 보기', exact: true }).click();
  await page.getByText('게시물을 표시하지 못했어요.', { exact: false }).waitFor();
  check(await page.getByRole('button', { name: '게시물 접기', exact: true }).evaluate(e => e.classList.contains('button-secondary')), 'collapse uses shared secondary button style');
  check(await page.getByRole('link', { name: 'Instagram에서 원문 보기', exact: true }).first().getAttribute('href') === 'https://www.instagram.com/p/ABCDE/', 'blocked embed preserves original post link');
  await page.getByRole('button', { name: '게시물 접기', exact: true }).click();
  check(await page.locator('.event-instagram-embed').innerText() === '', 'collapse removes embed contents');
  check(errors.length === 0, 'no uncaught browser errors');
  await page.screenshot({ path: 'output/playwright/event-presentation-0911.png', fullPage: true });
  return { results, qualification: 'actual components with synthetic event and blocked external requests; not real Instagram validation' };
}
