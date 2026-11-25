import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const profile = process.env.YUANBAO_PROBE_PROFILE;
if (!profile || !path.isAbsolute(profile)) throw new Error('请设置绝对路径 YUANBAO_PROBE_PROFILE，指向仓库外的专用浏览器目录。');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const resolved = path.resolve(profile);
const rel = path.relative(repo, resolved);
if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) throw new Error('浏览器配置目录必须位于交付仓库外。');
await fs.mkdir(resolved, { recursive: true });
const context = await chromium.launchPersistentContext(resolved, { headless: false, channel: 'msedge' });
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('https://yuanbao.tencent.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('已打开元宝网页。请确认登录并选择专家模式，回到终端按 Enter 检查页面控件。');
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  let watchTimer = null;
  let watchBusy = false;
  let watchFile = null;
  let watchPrevious = '';
  const stopWatch = async () => {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
    while (watchBusy) await new Promise(resolve => setTimeout(resolve, 50));
  };
  const sample = async () => {
    if (watchBusy || !watchFile) return;
    watchBusy = true;
    try {
      const state = await page.evaluate(() => {
        const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const texts = [...document.querySelectorAll('body *')].filter(visible).flatMap(e => [...e.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim())).filter(Boolean);
        const allowed = ['登录', '立即登录', '上传中', '上传失败', '上传完成', '停止生成', '停止', '生成中', '思考中', '发送', '新建对话'];
        const flags = Object.fromEntries(allowed.map(label => [label, texts.includes(label) || [...document.querySelectorAll('[aria-label],[title]')].some(e => visible(e) && (e.getAttribute('aria-label') === label || e.getAttribute('title') === label))]));
        const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
        const actionButtons = buttons.filter(e => /发送|停止|send|stop/i.test([e.getAttribute('aria-label'), e.getAttribute('title'), e.className].filter(x => typeof x === 'string').join(' '))).map(e => ({ label: ['发送','停止','停止生成'].includes(e.getAttribute('aria-label')) ? e.getAttribute('aria-label') : null, disabled: e.matches(':disabled') || e.getAttribute('aria-disabled') === 'true', class: typeof e.className === 'string' ? e.className.slice(0, 160) : null }));
        const answers = [...document.querySelectorAll('.hyc-content-text,.ybc-p')].filter(visible);
        return { flags, visible_editors: [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].filter(visible).length, visible_file_cards: [...document.querySelectorAll('span[class*="file-card_title"][title$=".txt"]')].filter(visible).length, visible_input_attachments: [...document.querySelectorAll('.hyc-content-file__info__name')].filter(visible).length, visible_download_controls: [...document.querySelectorAll('[aria-label="下载"]')].filter(visible).length, action_buttons: actionButtons, visible_text_blocks: answers.length, visible_text_characters: answers.reduce((n, e) => n + (e.innerText || '').length, 0) };
      });
      const signature = JSON.stringify(state);
      if (signature !== watchPrevious) {
        watchPrevious = signature;
        await fs.appendFile(watchFile, JSON.stringify({ timestamp: new Date().toISOString(), ...state }) + '\n');
        console.log('状态变化已记录。');
      }
    } catch {
      await fs.appendFile(watchFile, JSON.stringify({ timestamp: new Date().toISOString(), error: 'page_observation_failed' }) + '\n');
    } finally { watchBusy = false; }
  };
  while (true) {
  const action = await input.question('watch 开始观察；stop 停止观察；upload 选择文件；send 发送；Enter 检查；q 关闭：');
  if (action.trim().toLowerCase() === 'q') break;
  if (action.trim().toLowerCase() === 'watch') {
    if (watchTimer) { console.log('观察已在进行。'); continue; }
    const dir = path.join(path.dirname(resolved), 'observations');
    await fs.mkdir(dir, { recursive: true });
    watchFile = path.join(dir, `state-${randomUUID()}.jsonl`);
    watchPrevious = '';
    await sample();
    watchTimer = setInterval(() => { void sample(); }, 1000);
    console.log(`开始观察：${watchFile}。请在网页操作；完成后输入 stop。`);
    continue;
  }
  if (action.trim().toLowerCase() === 'stop') {
    await stopWatch();
    console.log(watchFile ? `观察已停止：${watchFile}` : '没有正在记录的观察。');
    continue;
  }
  if (action.trim().toLowerCase() === 'hover') {
    try {
      const control = page.locator('[aria-label="下载"]:visible');
      if (await control.count() !== 1) throw new Error('未找到唯一的下载控件，请先打开文件预览');
      await control.hover({ timeout: 5000 });
      await page.waitForTimeout(700);
      console.log('已悬停下载控件，正在检查菜单。');
    } catch (error) {
      console.log(`悬停未完成：${error.message.split('\n')[0]}`);
      continue;
    }
  }
  if (action.trim().toLowerCase() === 'upload') {
    try {
      const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'smoke-input.txt');
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        page.getByText('本地文件', { exact: true }).click({ timeout: 5000 })
      ]);
      await chooser.setFiles(file);
      console.log('已通过文件选择器选择 smoke-input.txt；请在页面确认是否显示附件。未发送消息。');
    } catch (error) {
      console.log(`文件选择器探测未完成：${error.message.split('\n')[0]}`);
    }
    continue;
  }
  if (action.trim().toLowerCase() === 'send') {
    try {
      const editor = page.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({ visible: true });
      if (await editor.count() !== 1) throw new Error('可见输入框数量不是 1，停止发送');
      await editor.fill('请读取我上传的文本文件，创建一个内容完全相同的文本文件供我下载。');
      await editor.press('Enter');
      console.log('已填入提示词并按 Enter；请在页面确认消息是否发出及任务是否完成。不要重复发送。');
    } catch (error) {
      console.log(`发送探测未完成：${error.message.split('\n')[0]}。请先确认页面状态，不要直接重试。`);
    }
    continue;
  }
  if (action.trim().toLowerCase() === 'download') {
    try {
      const control = page.locator('[aria-label="下载"]:visible');
      if (await control.count() !== 1) throw new Error('未找到唯一的下载控件，请先打开文件预览');
      await control.hover({ timeout: 5000 });
      const candidate = page.locator('.t-dropdown:visible').getByText('TXT', { exact: true });
      if (await candidate.count() !== 1) throw new Error('未找到唯一的 TXT 下载选项');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        candidate.click({ timeout: 5000 })
      ]);
      const outputDir = path.join(path.dirname(resolved), 'downloads', randomUUID());
      await fs.mkdir(outputDir, { recursive: true });
      const output = path.join(outputDir, 'smoke-output.txt');
      await download.saveAs(output);
      const expected = await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'smoke-input.txt'));
      const actual = await fs.readFile(output);
      const hash = data => createHash('sha256').update(data).digest('hex');
      console.log(JSON.stringify({ output, input_sha256: hash(expected), output_sha256: hash(actual), byte_equal: expected.equals(actual) }, null, 2));
    } catch (error) {
      console.log(`下载探测未完成：${error.message.split('\n')[0]}。请查看页面是否打开预览或显示其他下载按钮。`);
    }
    continue;
  }
  const inventory = await page.evaluate(() => {
    const visible = e => !!(e.getBoundingClientRect().width && e.getBoundingClientRect().height);
    return {
      url_origin: location.origin,
      inputs: [...document.querySelectorAll('input')].filter(visible).map(e => ({ type: e.type, label: e.getAttribute('aria-label'), placeholder: e.getAttribute('placeholder') })),
      file_inputs: document.querySelectorAll('input[type="file"]').length,
      editables: document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]').length,
      buttons: [...document.querySelectorAll('button,[role="button"],[role="menuitem"]')].filter(visible).map(e => ({ label: (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || '').trim().slice(0, 80) })).filter(e => e.label).slice(0, 80),
      unlabeled_controls: [...document.querySelectorAll('button,[role="button"],a,[title],[aria-label]')].filter(visible).filter(e => !(e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || '').trim()).map(e => ({ tag: e.tagName, role: e.getAttribute('role'), class: typeof e.className === 'string' ? e.className.slice(0, 120) : null, svg: !!e.querySelector('svg'), download_attribute: e.hasAttribute('download') })).slice(-60),
      frames: document.querySelectorAll('iframe').length,
      export_controls: [...document.querySelectorAll('[class*="export-format"],[role="menu"],[role="menuitem"]')].filter(visible).map(e => ({tag:e.tagName, role:e.getAttribute('role'), class:typeof e.className === 'string' ? e.className.slice(0,120) : null, label:e.getAttribute('aria-label'), text:(e.innerText || '').trim().slice(0,200)})).slice(-30),
      download_candidates: [...document.querySelectorAll('body *')].filter(visible).filter(e => {
        const own = [...e.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
        return /下载|download|\.txt/i.test([own, e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('data-testid')].filter(Boolean).join(' ')) && own.length < 100;
      }).slice(-40).map(e => ({tag:e.tagName, role:e.getAttribute('role'), class: typeof e.className === 'string' ? e.className.slice(0,120) : null, title:e.getAttribute('title'), aria_label:e.getAttribute('aria-label'), text:[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim().slice(0,80)}))
    };
  });
  console.log(JSON.stringify(inventory, null, 2));
  console.log('检查完成；可以操作页面后再次按 Enter 检查。');
  }
  await stopWatch();
  input.close();
} finally {
  await context.close();
}
