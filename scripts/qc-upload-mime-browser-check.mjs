async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  const formats = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', hwp: 'application/x-hwp', hwpx: 'application/hwp+zip' };
  await page.setViewportSize({ width: 390, height: 900 });
  for (const [extension, canonical] of Object.entries(formats)) {
    await page.goto(base + '/contribute');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole('textbox', { name: '제목', exact: true }).fill('합성 MIME 선택 검증');
    await page.getByRole('textbox', { name: '만든 사람 또는 단체', exact: true }).fill('합성 청년회');
    await page.getByRole('radio', { name: '파일', exact: true }).check();
    await page.locator('.file-field input[type=file]').first().evaluate((input, ext) => {
      const transfer = new DataTransfer();
      // Tests browser metadata/selection only, not file decoding or malware scanning.
      transfer.items.add(new File(['synthetic selection bytes'], 'mime-test.' + ext, { type: '' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, extension);
    await page.getByText('mime-test.' + extension, { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '누가 볼 수 있나요' }).selectOption('공개');
    await page.getByRole('checkbox', { name: /공유할 권한/ }).check();
    await page.evaluate(() => {
      window.__weaveTest.callableResponses = {
        createSubmission: async () => ({ submissionId: 'synthetic-mime' }),
        prepareSubmissionUploads: async () => { throw new Error('합성 검사: 저장 전 중단'); },
      };
    });
    await page.getByRole('button', { name: '게시하기', exact: true }).click();
    await page.getByText('합성 검사: 저장 전 중단', { exact: true }).waitFor();
    const descriptor = await page.evaluate(() => window.__weaveTest.calls.find(call => call.name === 'prepareSubmissionUploads')?.input.files[0]);
    if (descriptor?.contentType !== canonical || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error(extension + ' descriptor mismatch');
    results.push(extension + ': empty browser MIME -> canonical upload descriptor');
  }
  await page.evaluate(() => { sessionStorage.clear(); });
  await page.reload();
  await page.evaluate(value => { window.__qcMime = value; }, { results, qualification: 'synthetic File metadata and actual form/descriptor only; stops before Storage; no real-format decoding or production writes' });
}
