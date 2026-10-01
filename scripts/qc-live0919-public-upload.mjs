// Self-authored, user-approved live fixture only. Never reads session tokens.
async page => {
  const title = 'QC-2026-09-19-public-CSV';
  await page.goto('https://won-archive-weave.web.app/contribute');
  await page.getByRole('textbox', {name:'제목', exact:true}).fill(title);
  await page.getByRole('combobox', {name:'게시 위치'}).selectOption('자료');
  await page.getByRole('textbox', {name:'만든 사람 또는 단체',exact:true}).fill('위브 기능 검증');
  await page.getByRole('radio', {name:'파일',exact:true}).check();
  await page.locator('input[type=file][accept*=hwp]').setInputFiles('scripts/fixtures/QC-2026-09-19-회의록.csv');
  await page.getByRole('combobox', {name:'누가 볼 수 있나요'}).selectOption('공개');
  await page.getByRole('checkbox', {name:'공유할 권한이 있으며',exact:false}).check();
  const pending=page.waitForResponse(r=>r.url().endsWith('/submitSubmission')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'게시하기',exact:true}).click();
  const response=await pending;
  const data=await response.json();
  if(response.status()!==200||data.error) return {http:response.status(),error:data.error?.status};
  await page.getByRole('link',{name:'내 게시물 관리',exact:true}).click();
  const own=page.locator('.submission-manager-item').filter({hasText:title});
  await own.waitFor();
  return {http:response.status(),status:data.result?.status,ownText:await own.innerText()};
}
