async (page) => {
  const results=[];
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for(const path of ['/','/resources','/archive','/calendar?month=2026-10','/events/synthetic-event-0','/contribute?intent=material','/calendar/new','/community','/profile?tab=activity']) {
      await page.goto('http://127.0.0.1:4193'+path);await page.locator('h1').first().waitFor();await page.waitForTimeout(1300);
      await page.addScriptTag({url:'http://127.0.0.1:4193/node_modules/axe-core/axe.min.js'});
      const axe=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));
      results.push({width,path,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),passes:axe.passes.length});
    }
  }
  return {synthetic:true,results};
}
