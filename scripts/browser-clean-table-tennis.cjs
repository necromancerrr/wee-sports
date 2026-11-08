// Normal TV copy stays quiet; verification tools require an explicit URL opt-in.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {mkdirSync,writeFileSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5219';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM||'/usr/bin/chromium',headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],checks=[];
  try {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/table-tennis.html');
    await page.locator('#table-court canvas').waitFor();
    for(const selector of ['.tt-message','#tt-mode','#tt-player-tag','#tt-bot-tag','.tt-controls','#tt-help'])
      assert.equal(await page.locator(selector).isVisible(),false,selector);
    assert.equal(await page.locator('.tt-score').isVisible(),true);
    assert.equal(await page.evaluate(()=>typeof window.__weeDiagnostics),'undefined');
    checks.push('Normal play keeps the score and removes instructional, diagnostic, mode and floating-player text');
    if(process.env.WEE_SMOKE_SCREENSHOTS){mkdirSync(process.env.WEE_SMOKE_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.WEE_SMOKE_SCREENSHOTS,'table-tennis-clean.png')});}
    await page.goto(base+'/table-tennis.html?diagnostics=1');
    await page.locator('.tt-controls').waitFor();
    assert.equal(await page.locator('#tt-help').isVisible(),true);
    assert.equal(await page.locator('#tt-mode').isVisible(),true);
    await page.waitForFunction(()=>window.__weeDiagnostics?.snapshot().scopes['game.table-tennis']?.timings['frame.intervalMs']?.count>3);
    const diagnostics=await page.evaluate(()=>window.__weeDiagnostics.snapshot());
    const frame=diagnostics.scopes['game.table-tennis'].timings['frame.intervalMs'];
    assert.ok(frame.p50<=frame.p95 && frame.p95<=frame.p99);
    checks.push('Explicit diagnostics restores verification text and bounded local-clock frame percentiles');
    assert.deepEqual(errors,[]);
    const report={recordedAt:new Date().toISOString(),checks,errors,limitations:['Software WebGL and synthetic browser input; no physical iPhone latency measurement.']};
    if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
