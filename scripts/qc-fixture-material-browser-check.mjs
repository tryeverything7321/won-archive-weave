async (page) => {
  const base = 'http://127.0.0.1:4191';
  await page.route('**/*', r => r.request().url().startsWith(base + '/') ? r.continue() : r.abort());
  await page.goto(base + '/activities/career-visit');
  const rows = page.locator('.linked-materials .material-item');
  await rows.first().waitFor();
  if (await rows.count() !== 2) throw new Error('example activity must expose its two linked materials');
  const opacity = await rows.evaluateAll(es => es.map(e => Number(getComputedStyle(e).opacity)));
  if (opacity.some(value => value !== 1)) throw new Error('linked materials must not depend on scroll animation to become readable');
  return { results: ['two correct fixture materials rendered', 'essential material content visible before scrolling'], qualification: 'synthetic repository; not production links' };
}
