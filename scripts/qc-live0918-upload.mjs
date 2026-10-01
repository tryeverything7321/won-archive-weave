// Approved self-authored fixtures only. Uses visible UI, never account storage or tokens.
// One file per invocation. Preview and withdrawal are separate observed steps.
async page => {
  const format = 'md';
  const files = {
    md: 'scripts/fixtures/QC-2026-09-18-private.md',
    csv: 'scripts/fixtures/QC-2026-09-18-private.csv',
    pdf: '/tmp/weave-rhwp-probe.lELMKH/self-authored-hwp.pdf',
    hwp: '/tmp/weave-rhwp-probe.lELMKH/self-authored.hwp',
    hwpx: '/tmp/weave-rhwp-probe.lELMKH/self-authored.hwpx',
    docx: '/var/folders/w5/8hh3mr512cs0fplljfv3wb600000gn/T/weave-office-probe-vmcr2d/docx/synthetic.docx',
    pptx: '/var/folders/w5/8hh3mr512cs0fplljfv3wb600000gn/T/weave-office-probe-vmcr2d/pptx/synthetic.pptx',
    xlsx: '/var/folders/w5/8hh3mr512cs0fplljfv3wb600000gn/T/weave-office-probe-vmcr2d/xlsx/synthetic.xlsx',
    png: 'output/playwright/google-event-affiliation-mobile.png',
  };
  const title = `QC-2026-09-18-private-${format.toUpperCase()}`;
  await page.goto('https://won-archive-weave.web.app/contribute');
  await page.getByRole('textbox', { name: '제목', exact: true }).fill(title);
  await page.getByRole('combobox', { name: '게시 위치' }).selectOption('자료');
  await page.getByRole('textbox', { name: '만든 사람 또는 단체', exact: true }).fill('위브 기능 검증');
  await page.getByRole('radio', { name: '파일', exact: true }).check();
  await page.locator('input[type=file][accept*=hwp]').setInputFiles(files[format]);
  await page.getByRole('combobox', { name: '누가 볼 수 있나요' }).selectOption('보류');
  await page.getByRole('checkbox', { name: '공유할 권한이 있으며', exact: false }).check();
  const response = page.waitForResponse(r => r.url().endsWith('/submitSubmission') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '게시하기', exact: true }).click();
  const r = await response;
  const json = await r.json();
  if (r.status() !== 200 || json.error) return { format, http: r.status(), error: json.error?.status };
  await page.getByRole('link', { name: '내 게시물 관리', exact: true }).click();
  const own = page.locator('.submission-manager-item').filter({ hasText: title });
  await own.waitFor();
  return { format, title, http: r.status(), status: json.result?.status, ownText: await own.innerText() };
}
