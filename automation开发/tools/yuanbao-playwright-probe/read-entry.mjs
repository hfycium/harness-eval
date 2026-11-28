import { chromium } from 'playwright';
const context = await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});
  const add = page.getByRole('button',{name:'添加',exact:true});
  console.log('ADD_COUNT',await add.count());
  if(await add.count() === 1) { await add.click(); console.log('ADD_MENU',JSON.stringify(await page.locator('[role="menu"]:visible,[role="menuitem"]:visible').allTextContents())); }
  console.log('VISIBLE_ACTIONS',JSON.stringify(await page.locator('button:visible,[role="button"]:visible,[role="menuitem"]:visible').evaluateAll(es=>es.map(e=>(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim()).filter(Boolean).slice(0,60))));
} finally { await context.close(); }
