async page => {
  const base = 'http://127.0.0.1:4193';
  const checks = [];
  const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  await page.unrouteAll();
  await page.route('**/*', route => {
    const url = route.request().url();
    const publicFont = /^https:\/\/cdn\.jsdelivr\.net\/gh\/sun-typeface\/(SUIT|SUITE)@2\/fonts\/variable\/woff2\//.test(url);
    return url.startsWith(base + '/') || publicFont ? route.continue() : route.abort();
  });
  for (const width of [360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/member-test?tab=account');
    const opener = page.getByRole('button', { name: '안내 다시 보기', exact: true });
    await opener.waitFor();
    const badge = page.locator('.profile-hero-panel .weave-badge-label');
    await page.evaluate(() => document.fonts.ready);
    check(await badge.evaluate(el => getComputedStyle(el).color) === 'rgb(25, 25, 25)', `${width}: 카카오 배지 전경색`);
    check(await page.locator('.profile-card > p').last().evaluate(el => getComputedStyle(el).color) === 'rgb(20, 111, 168)', `${width}: 밝은 표면 안내 색상`);
    for (const closeMethod of ['escape', 'button']) {
      await opener.click();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '안내 닫기');
      if (closeMethod === 'escape') await page.keyboard.press('Escape');
      else await page.getByRole('button', { name: '안내 닫기', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      check(await opener.evaluate(el => el === document.activeElement), `${width}: 온보딩 ${closeMethod} 포커스 복귀`);
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: 프로필 가로 넘침 없음`);
    await page.screenshot({ path: `output/playwright/design-0923-profile-${width}.png`, fullPage: true });
    await page.goto(base + '/calendar/connect');
    const organization = page.getByRole('button', { name: '단체 공개 캘린더 연결', exact: true });
    await organization.click();
    await page.keyboard.press('Tab');
    check(await organization.getAttribute('aria-pressed') === 'true', `${width}: 연결 선택 ARIA`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.profile-section-nav button[aria-pressed="true"]')).backgroundColor === 'rgb(191, 233, 223)');
    check(await organization.evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(191, 233, 223)', `${width}: 연결 선택 배경 유지`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: 연결 화면 가로 넘침 없음`);
    await page.screenshot({ path: `output/playwright/design-0923-calendar-${width}.png`, fullPage: true });
  }
  return { checks, qualification: '합성 계정의 실제 컴포넌트·브라우저 뷰포트 검증. 실기기·라이브·200% 브라우저 확대 검증 아님' };
}
