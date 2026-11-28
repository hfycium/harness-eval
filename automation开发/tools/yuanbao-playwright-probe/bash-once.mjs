import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const source = await readFile('元宝边界探测/云端Bash单次探针-0.1.md','utf8');
const prompt = source.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1];
if (!prompt) throw Error('frozen_prompt_missing');
const id = randomUUID();
const file = `元宝边界探测/bash探针-${id}.json`;
const hash = value => createHash('sha256').update(value).digest('hex');
const record = {record_id:id, started_at:new Date().toISOString(), case_version:'0.1', source_sha256:hash(source), prompt, prompt_sha256:hash(prompt), submission:'not_sent', observations:[]};
await writeFile(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
let context;
try {
  context = await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});
  const page=context.pages()[0] ?? await context.newPage();
  await page.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:'切换模型',exact:true}).click();
  const expert=page.locator('button:visible,[role="button"]:visible').filter({hasText:/^专家模式\s*使用工具，处理多步任务$/});
  if(await expert.count()!==1) throw Error('expert_mode_ambiguous');
  await expert.click();
  const editor=page.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({visible:true});
  if(await editor.count()!==1) throw Error('editor_ambiguous');
  await editor.fill(prompt);
  record.submission='send_attempting'; await writeFile(file,JSON.stringify(record,null,2)+'\n');
  await editor.press('Enter'); record.submission='enter_pressed_once';
  await writeFile(file,JSON.stringify(record,null,2)+'\n');
  await page.waitForTimeout(45000);
  const body=await page.locator('body').innerText();
  const i=body.indexOf(prompt);
  record.observations.push({timestamp:new Date().toISOString(),source:'visible_page',prompt_visible:i>=0,text:i>=0?body.slice(i,i+7000):null});
  const header=page.locator('.hyc-component-deep-search-agent__think__header').filter({hasText:'已处理'});
  if(await header.count()===1) {
    await header.click();
    const group=page.getByText(/已运行\d+次命令/,{exact:true});
    if(await group.count()===1) await group.click();
    const actions=page.locator('[class*="agent-process-timeline_childTitle"]:visible');
    if(await actions.count()===1) await actions.click();
    record.observations.push({timestamp:new Date().toISOString(),source:'visible_product_timeline',text:await page.locator('.hyc-component-deep-search-agent').innerText().catch(()=>null)});
  }
} catch(e) { record.error=e.message; }
finally { record.finished_at=new Date().toISOString(); await writeFile(file,JSON.stringify(record,null,2)+'\n'); if(context) await context.close(); }
console.log(JSON.stringify(record));
