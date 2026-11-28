import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const c=await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});
try {
  const p=c.pages()[0]??await c.newPage(); await p.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForTimeout(4000);
  const item=p.locator('.yb-recent-conv-list__item-name:visible').filter({hasText:'Excel行最大值列标题公式'});
  console.log('MATCH_COUNT',await item.count()); if(await item.count()!==1) throw Error('history_ambiguous');
  await item.click(); await p.waitForTimeout(3000);
  const cards=p.locator('span[class*="file-card_title"][title$=".xlsx"]:visible');
  console.log('XLSX_CARD_COUNT',await cards.count());
  if(await cards.count()===1) {
    console.log('CARD_TITLE',await cards.getAttribute('title'));
    await cards.click(); await p.waitForTimeout(1500);
    const download=p.locator('[aria-label="下载"]:visible');
    console.log('DOWNLOAD_CONTROL_COUNT',await download.count());
    if(await download.count()===1){
      await download.hover(); await p.waitForTimeout(800); console.log('DOWNLOAD_MENU',JSON.stringify(await p.locator('.t-dropdown:visible').allTextContents()));
      const choice=p.locator('.t-dropdown:visible').getByText('XLSX',{exact:true});
      if(await choice.count()!==1) throw Error('xlsx_choice_ambiguous');
      const [artifact]=await Promise.all([p.waitForEvent('download',{timeout:30000}),choice.click()]);
      const dest='元宝边界探测/历史59196回收-2026-11-25.xlsx';
      const { open }=await import('node:fs/promises'); const guard=await open(dest,'wx'); await guard.close();
      await artifact.saveAs(dest);
      const data=await readFile(dest); console.log('DOWNLOAD_EVIDENCE',JSON.stringify({path:dest,size:data.length,sha256:createHash('sha256').update(data).digest('hex')}));
    }
  }
} finally {await c.close();}
