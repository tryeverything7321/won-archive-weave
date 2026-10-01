async root => {
 const page=await root.context().newPage();const origin='http://127.0.0.1:4193';const results=[];
 const check=(pass,name,detail)=>{results.push({name,pass:Boolean(pass),detail});if(!pass)throw new Error(name+' '+JSON.stringify(detail));};
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/__fixture__/portrait.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="420" height="840"><rect width="420" height="840" fill="#143957"/><text x="40" y="80" fill="white" font-size="30">합성 행사 포스터</text><rect x="30" y="180" width="360" height="600" fill="#BFE9DF"/></svg>'});if(url.origin===origin||['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.continue();return route.abort();});
 for(const width of [1440,984,390]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/?upcomingCount=1&upcomingPhoto=1');await page.getByRole('link',{name:'합성 행사 0',exact:true}).waitFor();await page.waitForTimeout(150);
  const home=await page.locator('[aria-labelledby="upcoming-events-title"] img').boundingBox();check(home.height<=220&&home.width<=Math.max(220,width),'home poster limited '+width,home);
  await page.evaluate(()=>{window.__weaveTest.eventExtras={thumbnail:{url:location.origin+'/__fixture__/portrait.svg',alt:'합성 세로 포스터',displayMode:'contain'}};history.pushState({},'','/events/synthetic-event-0');dispatchEvent(new PopStateEvent('popstate'));});
  const expand=page.getByRole('button',{name:'합성 세로 포스터 크게 보기'});await expand.waitFor();await expand.scrollIntoViewIfNeeded();await page.waitForTimeout(150);
  const image=await expand.locator('img').boundingBox();check(image.height<=340&&image.width<=440,'detail poster limited '+width,image);
  check(await expand.locator('img').evaluate(el=>getComputedStyle(el).objectFit==='contain'),'portrait entire preview '+width);
  await page.screenshot({path:`work/weave-ui-review/oct01-journeys/poster-${width}.png`});
  await expand.click();check(await page.getByRole('dialog',{name:'행사 사진 크게 보기'}).isVisible(),'poster can expand '+width);await page.keyboard.press('Escape');check(await expand.evaluate(el=>document.activeElement===el),'poster focus returns '+width);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'poster no overflow '+width);
  await page.addScriptTag({url:origin+'/node_modules/axe-core/axe.min.js'});const axe=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));check(axe.violations.length===0,'poster detail axe '+width,axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
 }
 await page.close();return {results,scope:'synthetic portrait and local actual UI only'};
}
