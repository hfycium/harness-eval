import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const c=await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});
try {
  const p=c.pages()[0] ?? await c.newPage(); await p.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});
  await p.locator('.yb-recent-conv-list__item-name:visible').first().click(); await p.waitForTimeout(2000);
  if(!(await p.locator('body').innerText()).includes('PROBE_STATUS_OK')) throw Error('wrong_conversation');
  const header=p.locator('.hyc-component-deep-search-agent__think__header').filter({hasText:'已处理'});
  if(await header.count()!==1) throw Error('header_ambiguous'); await header.click();
  const group=p.getByText(/已运行\d+次命令/,{exact:true}); if(await group.count()!==1) throw Error('group_ambiguous'); await group.click();
  const actions=p.locator('[class*="agent-process-timeline_childTitle"]:visible'); if(await actions.count()!==1) throw Error('action_ambiguous'); await actions.click();
  const detail=await actions.evaluate(e=>{let n=e; for(let i=0;i<4;i++) n=n.parentElement; return n?.outerHTML;});
  const out={source:'product_timeline_dom',observed_at:new Date().toISOString(),action_html:detail};
  await writeFile('元宝边界探测/bash探针-947916ed-工具动作DOM.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(out));
} finally {await c.close();}
