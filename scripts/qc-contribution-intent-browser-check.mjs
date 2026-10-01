async page => {
  const base='http://127.0.0.1:4191'; const results=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);results.push(label)};
  await page.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
  await page.goto(base+'/contribute?intent=activity');
  await page.evaluate(()=>sessionStorage.clear());await page.reload();
  const kind=page.getByRole('combobox',{name:/^게시 위치/});
  const title=page.getByRole('textbox',{name:'제목',exact:true});
  await title.fill('활동 종류 전환 초안');
  await page.evaluate(()=>{history.pushState({},'', '/contribute?intent=material');dispatchEvent(new PopStateEvent('popstate'))});
  await page.waitForTimeout(100);
  check(await kind.inputValue()==='자료','same-route material intent selects material');
  check(await title.inputValue()==='','material entry does not inherit activity text');
  await page.evaluate(()=>{history.pushState({},'', '/contribute?intent=activity');dispatchEvent(new PopStateEvent('popstate'))});
  await page.getByRole('button',{name:'계속 작성',exact:true}).click();
  check(await title.inputValue()==='활동 종류 전환 초안','original activity draft survives entry change');
  await page.evaluate(()=>sessionStorage.clear());
  return {results,qualification:'local synthetic account; actual contribution component, no OAuth or production writes'};
}
