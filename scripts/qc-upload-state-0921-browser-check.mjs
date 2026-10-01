async page => {
  const base = 'http://127.0.0.1:4192';
  const checks = [];
  const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  await page.unrouteAll();
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const item = (id, overrides) => ({ id, title: id, kind: '자료', sourceMode: 'upload', status: 'unpublished', visibility: '공개', scanStatus: 'pending', attachmentStatus: 'pending', availableActions: [], ...overrides });
    window.__weaveTest = {
      user: { uid: 'synthetic-owner', getIdToken: async () => 'synthetic-token', getIdTokenResult: async () => ({ claims: {} }) },
      listeners: [], calls: [], posts: [], materials: [],
      callableResponses: {
        listMySubmissions: () => ({ submissions: [
          item('합성 공개 중단'),
          item('합성 철회', { status: 'withdrawn', availableActions: ['restore_private'] }),
          item('합성 중단 미리보기', { scanStatus: 'clean', attachmentStatus: 'clean', previewStatus: 'queued' }),
          item('합성 회수 중', { cleanupState: 'pending' }),
          item('합성 회수 실패', { cleanupState: 'dead_letter' }),
          item('합성 비공개 검사', { status: 'review_queued', visibility: '보류' }),
          item('합성 게시 검사 오류', { status: 'published', scanStatus: 'error', attachmentStatus: 'error' }),
        ], limit: 100, hasMore: false }),
        listOwnedEvents: () => ({ events: [] }),
      },
    };
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/management');
    const card = name => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card('합성 공개 중단').waitFor();
    for (const name of ['합성 공개 중단', '합성 철회', '합성 중단 미리보기']) {
      check(!/첨부 파일을 확인|변환 준비 중|검사 중|검사 완료/.test(await card(name).innerText()), `${width}: ${name} 종료 후 진행 안내 없음`);
    }
    check((await card('합성 회수 중').innerText()).includes('파일 회수 중'), `${width}: 실제 회수 진행 안내 유지`);
    check((await card('합성 회수 실패').innerText()).includes('파일 회수 확인 필요'), `${width}: 회수 실패 조치 안내 유지`);
    check((await card('합성 비공개 검사').innerText()).includes('첨부 파일을 확인'), `${width}: 진행 중인 비공개 검사 안내 유지`);
    check((await card('합성 게시 검사 오류').innerText()).includes('서비스 처리 오류'), `${width}: 게시 첨부 검사 오류 안내 유지`);
    check(await card('합성 철회').getByRole('button', { name: '비공개 초안으로 복원', exact: true }).count() === 1, `${width}: 복원 경로 유지`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: 가로 넘침 없음`);
    await page.screenshot({ path: `output/playwright/upload-state-0921-${width}.png`, fullPage: true });
  }
  return { checks, qualification: '합성 계정과 응답의 실제 React 화면 검증. 라이브 저장·권한·검사 완료 증거는 아님' };
}
