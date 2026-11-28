import { chromium } from 'playwright';

const profile = process.env.YUANBAO_PROBE_PROFILE;
if (!profile) throw Error('YUANBAO_PROBE_PROFILE required');
const browser = await chromium.launchPersistentContext(profile, { headless: false, channel: 'msedge' });
try {
  const page = browser.pages()[0] ?? await browser.newPage();
  await page.goto('https://yuanbao.tencent.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const list = () => page.locator('button:visible,[role="button"]:visible,[role="menuitem"]:visible').evaluateAll(es => es.map(e => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || '').trim()).filter(Boolean).slice(0, 80));
  console.log('INITIAL', JSON.stringify(await list()));
  const switcher = page.getByRole('button', { name: '切换模型', exact: true });
  if (await switcher.count() === 1) {
    await switcher.click();
    console.log('MODEL_MENU', JSON.stringify(await page.locator('[role="menu"]:visible,[role="listbox"]:visible,[role="menuitem"]:visible').allTextContents()));
    console.log('MODEL_BUTTONS', JSON.stringify(await list()));
    const expert = page.locator('button:visible,[role="button"]:visible').filter({ hasText: '专家模式' });
    if (await expert.count() !== 1) throw Error('expert_mode_ambiguous');
    await expert.click();
    console.log('EXPERT_SELECTED', JSON.stringify(await list()));
    const editor = page.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({ visible: true });
    if (await editor.count() !== 1) throw Error('editor_ambiguous');
    const prompt = '请使用你当前会话中实际提供的代码执行工具运行一次下列 Python 代码，并展示工具的原始调用和初始返回。如果没有可用执行工具，请直接说明无法运行，不要模拟结果。\n\nprint("YUANBAO_PROBE_7319")';
    await editor.fill(prompt);
    await editor.press('Enter');
    console.log('SUBMISSION', 'enter_pressed_once');
    await page.waitForTimeout(30000);
    const blocks = await page.locator('.hyc-content-text,.ybc-p').filter({ visible: true }).allTextContents();
    console.log('VISIBLE_BLOCKS', JSON.stringify(blocks.slice(-12).map(s => s.slice(0, 3500))));
    console.log('FINAL_BUTTONS', JSON.stringify(await list()));
  }
} finally { await browser.close(); }
