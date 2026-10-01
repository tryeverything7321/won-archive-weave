async page => {
  const base = 'http://127.0.0.1:4191';
  const results = [];
  const check = (value, label) => { if (!value) throw Error(label); results.push(label); };
  await page.unrouteAll();
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/activities/event-from-scratch');
    await page.locator('.recipe-panel dd').first().waitFor();
    const contrast = await page.locator('.recipe-panel').evaluate(panel => {
      const luminance = color => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const background = luminance(getComputedStyle(panel).backgroundColor);
      return [...panel.querySelectorAll('dt,dd')].map(element => {
        const foreground = luminance(getComputedStyle(element).color);
        return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
      });
    });
    check(contrast.length === 8 && contrast.every(value => value >= 4.5), `${width}: 목적·준비·홍보·회고 본문과 라벨 대비 4.5 이상`);
    for (const path of ['/archive', '/resources', '/contribute', '/calendar/new', '/calendar/connect', '/community', '/member-test']) {
      await page.goto(base + path);
      await page.locator('main').waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: ${path} 가로 넘침 없음`);
    }
    const selected = page.getByRole('tab', { selected: true });
    await selected.waitFor();
    const inactive = page.getByRole('tab', { selected: false }).first();
    check(await selected.evaluate(e => getComputedStyle(e).backgroundColor) !== await inactive.evaluate(e => getComputedStyle(e).backgroundColor), `${width}: 내 위브 선택 탭 지속 표시`);
    await selected.focus();
    await page.keyboard.press('ArrowRight');
    check(await page.getByRole('tab', { selected: true }).evaluate(e => e === document.activeElement), `${width}: 탭 방향키 선택과 포커스 일치`);
    await page.goto(base + '/community');
    const purpose = page.locator('.community-purpose-filters button').nth(1);
    await purpose.click();
    await page.locator('textarea').focus();
    check(await purpose.getAttribute('aria-pressed') === 'true', `${width}: 커뮤니티 선택 상태 유지`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.community-purpose-filters button[aria-pressed="true"]')).backgroundColor !== getComputedStyle(document.querySelector('.community-purpose-filters button[aria-pressed="false"]')).backgroundColor);
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.community-purpose-filters button[aria-pressed="true"]')).backgroundColor !== getComputedStyle(document.querySelector('.community-purpose-filters button[aria-pressed="false"]')).backgroundColor), `${width}: 커뮤니티 포커스 이동 후 선택 시각화`);
    await page.screenshot({ path: `output/playwright/qa0917-community-${width}.png`, fullPage: true });
  }
  await page.goto(base + '/archive?type=활동+레시피&topic=관계와+공동체&q=없는검증문자&examples=1');
  await page.getByRole('button', { name: '전체 기록 보기', exact: true }).click();
  check(await page.evaluate(() => { const query = new URL(location.href).searchParams; return !query.has('q') && !query.has('topic') && !query.has('type') && query.get('examples') === '1'; }), '전체 기록 보기: 검색·주제·형식 초기화, 예시 유지');
  await page.goto(base + '/member-test');
  await page.evaluate(() => { window.__weaveTest.materials = [{ id: 'qa0917-material', title: 'QA 합성 회의록', status: 'published', visibility: 'public', sourceMode: 'text', textContent: { schemaVersion: 1, format: 'markdown', body: '## 합성 회의록\n운영 데이터가 아닌 자체 테스트입니다.' } }]; });
  await page.getByRole('link', { name: '자료 나눔', exact: true }).first().click();
  await page.getByRole('button', { name: '글·회의록만 보기', exact: true }).click();
  const disclosure = page.locator('.fixture-collection details');
  await disclosure.locator('summary').click();
  await page.locator('a[href="/materials/qa0917-material"]').first().click();
  await page.getByRole('heading', { name: 'QA 합성 회의록', exact: true }).waitFor();
  await page.getByRole('link', { name: '자료 목록으로 돌아가기' }).click();
  check(await page.evaluate(() => new URL(location.href).searchParams.get('type') === 'TEXT'), '실제 자료 상세 컴포넌트에서 필터 복귀');
  check(await disclosure.evaluate(e => e.open), '실제 자료 상세 컴포넌트에서 예시 펼침 복귀');
  return { results, qualification: '로컬 실제 React 화면 + 합성 계정/자료/응답. 운영 업로드, 외부 인증, 모바일 실기기는 별도 미검증' };
}
