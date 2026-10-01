async root => {
 const page=await root.context().newPage();const origin='http://127.0.0.1:4193';
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin||['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/');await page.locator('main h1').waitFor();await page.waitForTimeout(1300);
 await page.evaluate(()=>{localStorage.removeItem('weave-launch-feedback-v1:synthetic-a');const s=window.__weaveTest;s.user.metadata={creationTime:'2026-10-01T00:00:00Z'};s.listeners.forEach(f=>f(s.user));});
 await page.waitForTimeout(31000);
 await page.locator('a[href="/resources"]').filter({visible:true}).first().click();await page.locator('main h1').waitFor();
 await page.getByRole('complementary',{name:'위브 오픈과 피드백 안내'}).waitFor({timeout:35000});
 await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(500);
 await page.screenshot({path:'work/weave-ui-review/oct01-journeys/launch-nudge-390-realtime.png'});
 const heading=await page.locator('main h1').evaluate(el=>({text:el.innerText,rect:el.getBoundingClientRect().toJSON(),opacity:getComputedStyle(el).opacity}));
 await page.close();return {realTime:true,heading,scope:'synthetic new account, real timers and actual route link'};
}
