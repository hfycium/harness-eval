import { chromium } from 'playwright';
const context = await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE, {headless:false,channel:'msedge'});
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://yuanbao.tencent.com/', {waitUntil:'domcontentloaded',timeout:60000});
  const item = page.locator('.yb-recent-conv-list__item-name:visible').first();
  console.log('LATEST_TITLE', await item.innerText());
  await item.click();
  await page.waitForTimeout(3000);
  const text = await page.locator('body').innerText();
  if (!text.includes('pwd; uname -s; command -v cmd.exe')) throw Error('environment_probe_not_found');
  const header = page.locator('.hyc-component-deep-search-agent__think__header').filter({hasText:'已处理'});
  if (await header.count() !== 1) throw Error('processing_header_ambiguous');
  await header.click();
  const group = page.getByText(/已运行\d+次命令/, {exact:true});
  console.log('GROUP_COUNT', await group.count());
  if (await group.count() === 1) await group.click();
  console.log('TIMELINE', JSON.stringify(await page.locator('.hyc-component-deep-search-agent').allTextContents()));
  const action = page.getByText('已执行用户指定的只读命令', {exact:true});
  console.log('ACTION_COUNT', await action.count());
  if (await action.count() === 1) {
    console.log('ACTION_STRUCTURE', await action.evaluate(e => e.parentElement?.outerHTML.slice(0,5000)));
    await action.click();
    await page.waitForTimeout(1000);
    console.log('ACTION_DETAILS', JSON.stringify(await page.locator('.hyc-component-deep-search-agent').allTextContents()));
    console.log('ACTION_EXPANDED_HTML', await action.evaluate(e => { let p=e; for(let i=0;i<4;i++) p=p.parentElement; return p?.outerHTML.slice(0,12000); }));
    console.log('DIALOGS', JSON.stringify(await page.locator('[role="dialog"]:visible,[role="menu"]:visible').allTextContents()));
  }
} finally { await context.close(); }
