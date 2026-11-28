import { chromium } from 'playwright';

const context = await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE, { headless: false, channel: 'msedge' });
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://yuanbao.tencent.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const items = page.locator('.yb-recent-conv-list__item-name:visible');
  const target = items.filter({ hasText: '执行Python代码探测结果' });
  console.log('MATCH_COUNT', await target.count());
  if (await target.count() === 1) {
    await target.click();
    await page.waitForTimeout(4000);
    const visibleText = await page.locator('body').innerText();
    const marker = visibleText.lastIndexOf('YUANBAO_PROBE_7319');
    console.log('MARKER_FOUND', marker >= 0);
    if (marker >= 0) console.log('PROBE_VISIBLE_TEXT', JSON.stringify(visibleText.slice(Math.max(0, marker - 200), marker + 8000)));
    console.log('VISIBLE_BUTTONS', JSON.stringify(await page.locator('button:visible,[role="button"]:visible').evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || '').trim()).filter(Boolean).slice(-50))));
    const header = page.locator('.hyc-component-deep-search-agent__think__header').filter({hasText:'已处理'});
    console.log('PROCESS_HEADERS', await header.count());
    if (await header.count() === 1) {
      await header.click();
      await page.waitForTimeout(1000);
      console.log('PROCESS_DETAILS', JSON.stringify(await page.locator('.hyc-component-deep-search-agent').allTextContents()));
      console.log('PROCESS_NODES', JSON.stringify(await page.locator('.hyc-component-deep-search-agent').evaluateAll(es => es.flatMap(e => [...e.querySelectorAll('*')].filter(x => x.children.length === 0 && /运行|命令/.test(x.textContent || '')).map(x => ({text:x.textContent.trim().slice(0,200), tag:x.tagName, class:x.className, parentClass:x.parentElement?.className}))).slice(0,20))));
      const group = page.getByText('已运行1次命令', { exact: true });
      if (await group.count() === 1) {
        await group.click();
        await page.waitForTimeout(1000);
        console.log('COMMAND_DETAILS', JSON.stringify(await page.locator('.hyc-component-deep-search-agent').allTextContents()));
      }
    }
  }
} finally { await context.close(); }
