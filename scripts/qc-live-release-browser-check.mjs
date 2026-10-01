async (page) => {
  const base = 'https://won-archive-weave.web.app';
  const errors = [];
  const results = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.unrouteAll();
  await page.route('**/*', route => {
    const url = route.request().url();
    const staticRequest = url.startsWith(base + '/') && !url.startsWith(base + '/oauth/');
    return staticRequest ? route.continue() : route.abort();
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/profile', '/community', '/calendar/new', '/contribute']) {
      const response = await page.goto(base + path);
      await page.locator('h1').first().waitFor();
      if (response.status() !== 200) throw new Error(`${path}: HTTP ${response.status()}`);
      if (!await page.locator('h1').first().innerText()) throw new Error(`${path}: empty heading`);
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) throw new Error(`${path}: overflow at ${width}`);
      results.push(`${path} ${width}px: rendered without overflow`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await page.screenshot({ path: 'output/playwright/qc-20260911-live-release.png', fullPage: true });
  return { results, pageErrors: errors, qualification: 'live static assets, signed-out only; external API calls blocked, no production data access or account mutations' };
}
