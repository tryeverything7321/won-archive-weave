async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  // Dedicated headless test browser; no existing user clipboard contents are read.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.goto(base + '/events/synthetic-event-0?examples=1');
  await page.bringToFront();
  await page.getByRole('button', { name: '행사 링크 복사', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '행사 링크를 복사했어요' }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(copied === base + '/events/synthetic-event-0', 'native clipboard contains the exact canonical event URL');
  check(!copied.includes('?'), 'copied URL excludes current navigation query');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.context().clearPermissions();
  return { results, qualification: 'dedicated headless Chromium, local synthetic event, native Clipboard API; not live or other browsers' };
}
