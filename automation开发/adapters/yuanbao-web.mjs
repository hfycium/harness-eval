import { HarnessAdapter } from './base.mjs';
import { createRequire } from 'node:module';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const requireProbe = createRequire(new URL('../tools/yuanbao-playwright-probe/package.json', import.meta.url));
const profileEnv = 'YUANBAO_PROBE_PROFILE';

export class YuanbaoWebAdapter extends HarnessAdapter {
  constructor() { super('yuanbao-web'); }
  snapshotConfig(config) {
    return { entry_id: config.entry_id, execution_method: 'playwright_web_assisted', browser: 'msedge', profile_configured: Boolean(process.env[profileEnv]), mode: 'operator_confirmed', experimental_auto_checks: config.experimental_auto_checks === true, internal_trace: 'unknown' };
  }
  permissionDescription() { return { requested_workspace: 'isolated_run_workspace', runtime_scope_confirmation: 'unknown' }; }
  preflight(config, { interactive, timeoutSeconds }) {
    const missing = [];
    if (config.entry_id !== 'yuanbao-web-playwright') missing.push('entry_id');
    if (!interactive) missing.push('interactive_terminal');
    const profile = process.env[profileEnv];
    if (!profile || !path.isAbsolute(profile)) missing.push('profile_path');
    else {
      const repository = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
      const rel = path.relative(repository, path.resolve(profile));
      if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) missing.push('profile_outside_repository');
    }
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) missing.push('timeout_seconds');
    try { requireProbe.resolve('playwright'); } catch { missing.push('playwright_dependency'); }
    return missing.length ? { status: 'not_admitted', missing, reason: '元宝网页需要交互终端、仓库外浏览器配置和 Playwright。' } : { status: 'ready', missing: [] };
  }
  buildInvocation() { throw new Error('yuanbao-web uses runSession'); }
  async runSession(context) {
    const { chromium } = requireProbe('playwright');
    const observations = [];
    const missing = ['effective_model', 'native_skill_state', 'internal_trace', 'web_desktop_equivalence'];
    let submitted = false;
    let browser;
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    const record = (source, event, status) => observations.push({ source, event, status, timestamp: new Date().toISOString() });
    const result = (execution_status, error = null) => ({
      submission_status: submitted ? 'submitted' : 'unconfirmed',
      submission_evidence: { prompt_submitted: submitted, ...(submitted ? { prompt_ref: 'prompt.md' } : {}), inputs: submitted ? [{ path: context.inputRelativePath.replaceAll('\\', '/'), sha256: context.inputSha256 }] : [] },
      execution_status, completion_evidence: { task_success_verified: false }, observations, missing, evidence_refs: ['yuanbao-web-events.json'], error,
    });
    const checkpoint = async message => {
      const answer = await input.question(`${message}\n输入 y 确认，其他输入停止：`, { signal: context.signal });
      if (answer.trim().toLowerCase() !== 'y') throw new Error('operator_stopped');
    };
    const abort = () => { input.close(); if (browser) browser.close().catch(() => {}); };
    context.signal.addEventListener('abort', abort, { once: true });
    try {
      if (context.expectedArtifacts.length !== 1 || !context.expectedArtifacts[0].toLowerCase().endsWith('.txt')) throw new Error('txt_single_artifact_required');
      browser = await chromium.launchPersistentContext(process.env[profileEnv], { channel: 'msedge', headless: false, acceptDownloads: true });
      const page = browser.pages()[0] ?? await browser.newPage();
      await page.goto('https://yuanbao.tencent.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await checkpoint('请登录元宝、选择专家模式并新建空对话。');
      record('operator_report', 'mode_and_new_chat', 'confirmed');
      await page.getByRole('button', { name: '添加', exact: true }).click();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.getByText('本地文件', { exact: true }).click()]);
      await chooser.setFiles(context.inputPath);
      await checkpoint('请确认附件已上传完成。');
      record('operator_report', 'attachment_ready', 'confirmed');
      const editor = page.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({ visible: true });
      if (await editor.count() !== 1) throw new Error('editor_ambiguous');
      await editor.fill(context.prompt);
      await editor.press('Enter');
      let promptObserved = false;
      if (context.config.experimental_auto_checks === true) {
        try {
          await page.waitForFunction(expected => [...document.querySelectorAll('.hyc-content-text')].some(e => {
            const rect = e.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (e.innerText || '').trim() === expected;
          }), context.prompt.trim(), { timeout: 10000 });
          promptObserved = true;
          record('adapter_session', 'prompt_visible', 'observed');
        } catch { record('adapter_session', 'prompt_visible', 'unconfirmed'); }
      }
      if (!promptObserved) {
        await checkpoint('请确认提示词已经发送；如状态不清楚请输入 n，勿重复提交。');
        record('operator_report', 'prompt_submitted', 'confirmed');
      }
      submitted = true;
      let candidateReady = false;
      if (context.config.experimental_auto_checks === true) {
        let previous = '';
        let stableSince = 0;
        const deadline = Date.now() + Math.min(120000, context.timeoutSeconds * 1000);
        while (!context.signal.aborted && Date.now() < deadline) {
          const snapshot = await page.evaluate(() => {
            const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
            const cards = [...document.querySelectorAll('span[class*="file-card_title"][title$=".txt"]')].filter(visible).length;
            const send = [...document.querySelectorAll('body *')].filter(visible).some(e => e.getAttribute('aria-label') === '发送' || e.getAttribute('title') === '发送' || [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim() === '发送'));
            const blocks = [...document.querySelectorAll('.hyc-content-text,.ybc-p')].filter(visible);
            return { cards, send, chars: blocks.reduce((n, e) => n + (e.innerText || '').length, 0), blocks: blocks.length };
          });
          const signature = JSON.stringify(snapshot);
          if (signature !== previous) { previous = signature; stableSince = Date.now(); }
          if (snapshot.cards === 1 && snapshot.send && Date.now() - stableSince >= 5000) { candidateReady = true; break; }
          await page.waitForTimeout(1000);
        }
        record('adapter_session', 'completion_heuristic', candidateReady ? 'candidate' : 'unconfirmed');
        missing.push('completion_heuristic_not_validated');
      }
      if (!candidateReady) {
        await checkpoint('请等待任务完成，并确认对话中本次生成的文本文件卡片已经出现。');
        record('operator_report', 'completion_and_artifact', 'confirmed');
      }
      const cards = page.locator('span[class*="file-card_title"][title$=".txt"]:visible');
      if (await cards.count() !== 1) throw new Error('artifact_card_ambiguous');
      await cards.click({ timeout: 10000 });
      record('adapter_session', 'artifact_preview_click', 'completed');
      const control = page.locator('[aria-label="下载"]:visible');
      await control.first().waitFor({ state: 'visible', timeout: 10000 });
      if (await control.count() !== 1) throw new Error('download_control_ambiguous');
      await control.hover();
      const choice = page.locator('.t-dropdown:visible').getByText('TXT', { exact: true });
      if (await choice.count() !== 1) throw new Error('download_format_ambiguous');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), choice.click()]);
      const relative = context.expectedArtifacts[0];
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => !x || x === '.' || x === '..')) throw new Error('invalid_artifact_path');
      const dest = path.resolve(context.workspaceDir, relative);
      const root = await realpath(context.workspaceDir);
      await mkdir(path.dirname(dest), { recursive: true });
      const parent = await realpath(path.dirname(dest));
      if (parent !== root && !parent.startsWith(root + path.sep)) throw new Error('artifact_path_escape');
      await download.saveAs(dest);
      record('adapter_session', 'download', 'completed');
      return result('completed');
    } catch (error) {
      record('adapter_session', 'execution', context.signal.aborted ? 'timed_out' : 'requires_action');
      missing.push('remote_task_state_unconfirmed');
      return result(context.signal.aborted ? 'timed_out' : 'requires_action', { code: error.message === 'operator_stopped' ? 'operator_stopped' : 'yuanbao_session_incomplete', phase: 'execute' });
    } finally {
      context.signal.removeEventListener('abort', abort);
      input.close();
      if (browser) await browser.close().catch(() => {});
      await writeFile(path.join(context.runDir, 'yuanbao-web-events.json'), JSON.stringify({ run_id: context.runId, observations, missing }, null, 2) + '\n');
    }
  }
}
