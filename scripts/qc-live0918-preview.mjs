// Self-authored QC records only. Does not return signed URLs or account data.
async page => {
  const format = 'hwp';
  const title = `QC-2026-09-18-private-${format.toUpperCase()}`;
  const own = page.locator('.submission-manager-item').filter({ hasText: title });
  await own.waitFor();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await own.waitFor();
  const trigger = own.getByRole('button', { name: '첨부 미리보기', exact: true });
  if (!(await trigger.count())) return { format, pending: true, ownText: await own.innerText() };
  const response = page.waitForResponse(r => r.url().endsWith('/createOwnerSubmissionAttachmentAccess') && r.request().method() === 'POST');
  await trigger.click();
  const r = await response;
  const json = await r.json();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return { format, http: r.status(), renderFormat: json.result?.renderFormat, error: json.error?.status,
    text: await dialog.innerText(), iframe: await dialog.locator('iframe').count(),
    imageLoaded: await dialog.locator('img').evaluateAll(els => els.every(e => e.complete && e.naturalWidth > 0)) };
}
