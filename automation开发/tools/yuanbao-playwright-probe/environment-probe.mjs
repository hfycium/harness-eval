import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const prompt = '请调用当前会话提供的命令工具一次，仅执行以下只读命令并原样展示初始工具返回；如没有可用工具请明确说明，不要模拟：\n\npwd; uname -s; command -v cmd.exe';
const context = await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE, { headless: false, channel: 'msedge' });
const record = { version:'0.1', started_at:new Date().toISOString(), prompt, prompt_sha256:createHash('sha256').update(prompt).digest('hex'), submission:'unconfirmed', observations:[] };
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://yuanbao.tencent.com/', {waitUntil:'domcontentloaded', timeout:60000});
  await page.getByRole('button', {name:'切换模型',exact:true}).click();
  const expert = page.locator('button:visible,[role="button"]:visible').filter({hasText:/^专家模式\s*使用工具，处理多步任务$/});
  if (await expert.count() !== 1) { record.observations.push({source:'model_menu', visible:await page.locator('[role="menu"]:visible,[role="listbox"]:visible').allTextContents(), expert_count:await expert.count()}); throw Error('expert_mode_ambiguous'); }
  await expert.click();
  const editor = page.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({visible:true});
  if (await editor.count() !== 1) throw Error('editor_ambiguous');
  await editor.fill(prompt);
  await editor.press('Enter');
  record.submission = 'enter_pressed_once';
  await page.waitForTimeout(40000);
  const text = await page.locator('body').innerText();
  const index = text.indexOf(prompt);
  record.observations.push({timestamp:new Date().toISOString(), source:'visible_page', prompt_visible:index >= 0, visible_text:index >= 0 ? text.slice(index, index+6000) : null});
} catch(e) { record.error = String(e.message); }
finally {
  record.finished_at = new Date().toISOString();
  await writeFile(`元宝边界探测/环境探针-${record.started_at.replaceAll(':','').replaceAll('.','-')}.json`, JSON.stringify(record,null,2)+'\n', {flag:'wx'});
  await context.close();
}
console.log(JSON.stringify(record));
