import { chromium } from 'playwright';
const context = await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});
  const item=page.locator('.yb-recent-conv-list__item-name:visible').first();
  console.log('LATEST_TITLE',await item.innerText()); await item.click(); await page.waitForTimeout(3000);
  const body=await page.locator('body').innerText();
  if (!body.includes('b6b5f86d-3d1e-4da5-bc8f-4653459c0a3d')) throw Error('wrong_conversation');
  const header=page.locator('.hyc-component-deep-search-agent__think__header').filter({hasText:'已处理'});
  console.log('PROCESS_HEADER_COUNT',await header.count());
  if (await header.count()===1) { await header.click(); console.log('TIMELINE',JSON.stringify(await page.locator('.hyc-component-deep-search-agent').allTextContents())); }
} finally { await context.close(); }
