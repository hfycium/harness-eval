import { HarnessAdapter } from './base.mjs';
import { createRequire } from 'node:module';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const requireProbe = createRequire(new URL('../tools/yuanbao-playwright-probe/package.json', import.meta.url));
const profileEnv = 'YUANBAO_PROBE_PROFILE';

// Reviewed frozen case, prompt and input bytes; changing any one requires a new review.
const reviewedCases = Object.freeze([Object.freeze({
  revision: 'yuanbao-reviewed-cases-1', capability: 'text_file_roundtrip',
  caseSha256: '18f7ad75963f96cad3d71bdfaa2285d5aca39878a2ac92ce4b33c6d2f4d5d71d',
  promptSha256: 'a0a4e9c8002d1d65c0c1394afb1d19fd926f0ec7d59ef295daea287b76eb9248',
  inputSha256: 'b5754cd6e6cfa0850f0a306eed66c63179af8a7657b53d7c4211c59b202c631a',
}), Object.freeze({
  revision: 'yuanbao-reviewed-cases-2', capability: 'xlsx_file_roundtrip',
  caseSha256: '63b58dc3069db25870dd16ee12aed7b56fb9cd97f8a2dfe436126e214ff186f3',
  promptSha256: '32369103a798c0a7a9ae5e09097cc4d7b30a54c1de80da7ccd0b35e2c9213cf6',
  inputSha256: '209d1a6de8c8d2cbf31bc4075c9b2c2299817d3fedf748727249c01ac2730495',
})]);

export function yuanbaoCapabilityAdmission(evidence) {
  const reviewed = reviewedCases.find(item => item.caseSha256 === evidence?.caseSha256 && item.promptSha256 === evidence?.promptSha256 && item.inputSha256 === evidence?.inputSha256);
  return reviewed ? { status: 'ready', capability: reviewed.capability, mapping_revision: reviewed.revision } : { status: 'not_admitted', capability: 'unknown', mapping_revision: 'yuanbao-reviewed-cases-2' };
}

export function yuanbaoArtifactFormat(expectedArtifacts, capability) {
  if (!Array.isArray(expectedArtifacts) || expectedArtifacts.length !== 1 || typeof expectedArtifacts[0] !== 'string') return null;
  const format = capability === 'text_file_roundtrip' ? 'txt' : capability === 'xlsx_file_roundtrip' ? 'xlsx' : null;
  return format && expectedArtifacts[0].toLowerCase().endsWith(`.${format}`) ? format : null;
}

export class YuanbaoWebAdapter extends HarnessAdapter {
  constructor() { super('yuanbao-web'); }
  snapshotConfig(config) {
    return { entry_id: config.entry_id, execution_method: 'playwright_web_assisted', browser: 'msedge', profile_configured: Boolean(process.env[profileEnv]), requested_model_label: config.model_label ?? 'Hy4', requested_mode_label: config.mode_label ?? '专家模式', effective_model: null, mode_selection: 'explicit_model_menu_click', popup_dismissal: 'visible_modal_close_controls_only', native_command_tool: 'not_integrated', runner_workspace_command_access: 'unverified', experimental_auto_checks: config.experimental_auto_checks === true, internal_trace: 'unknown' };
  }
  permissionDescription() { return { requested_workspace: 'isolated_run_workspace', runtime_scope_confirmation: 'unknown' }; }
  preflight(config, { interactive, timeoutSeconds, task, taskEvidence }) {
    const missing = [];
    const admission = yuanbaoCapabilityAdmission(taskEvidence);
    if (admission.status !== 'ready') missing.push('task_capability_not_reviewed');
    if (config.entry_id !== 'yuanbao-web-playwright') missing.push('entry_id');
    if ((config.model_label ?? 'Hy4') !== 'Hy4') missing.push('unsupported_model_label');
    if ((config.mode_label ?? '专家模式') !== '专家模式') missing.push('unsupported_mode_label');
    if (!interactive) missing.push('interactive_terminal');
    const artifacts = (task?.expected_artifacts ?? []).filter(item => typeof item === 'string' || item?.required !== false).map(item => typeof item === 'string' ? item : item.path);
    if (!yuanbaoArtifactFormat(artifacts, admission.capability)) missing.push('task_artifact_contract_unsupported');
    const commandTask = /(?:^|[\\/])[^\\/]+\.cmd$/i.test(task?.input_destination ?? '') || /^E8-/i.test(task?.dataset_task_id ?? '');
    if (commandTask) missing.push('native_command_tool_unavailable');
    const profile = process.env[profileEnv];
    if (!profile || !path.isAbsolute(profile)) missing.push('profile_path');
    else {
      const repository = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
      const rel = path.relative(repository, path.resolve(profile));
      if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) missing.push('profile_outside_repository');
    }
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) missing.push('timeout_seconds');
    try { requireProbe.resolve('playwright'); } catch { missing.push('playwright_dependency'); }
    return missing.length ? { status: 'not_admitted', missing, reason: '元宝网页适配器仅支持已审查的 TXT/XLSX 文件往返，未集成本地命令工具，且无法证明其可访问 Runner 工作区。' } : { status: 'ready', missing: [] };
  }
  buildInvocation() { throw new Error('yuanbao-web uses runSession'); }
  async runSession(context) {
    const { chromium } = requireProbe('playwright');
    const observations = [];
    const missing = ['effective_model', 'native_skill_state', 'internal_trace', 'native_tool_call_trace', 'web_desktop_equivalence', 'assistant_role_not_independently_verified'];
    const operatorConfirmations = [];
    const uiSelections = [];
    const popupChecks = [];
    let visibleResponseBlocks = [];
    let responseCaptureStatus = 'not_submitted';
    let submitted = false;
    let browser;
    let page;
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
    const dismissModalPopups = async phase => {
      const dialogs = page.locator('[role="dialog"]:visible,[aria-modal="true"]:visible,[class*="modal"]:visible,[class*="dialog"]:visible,[class*="popup"]:visible');
      const dialogCount = Math.min(await dialogs.count(), 8);
      let dismissed = 0;
      for (let index = 0; index < dialogCount && dismissed < 3; index++) {
        const dialog = dialogs.nth(index);
        const dialogBox = await dialog.boundingBox().catch(() => null);
        if (!dialogBox) continue;
        const controls = dialog.locator('button:visible,[role="button"]:visible');
        const count = Math.min(await controls.count(), 30);
        for (let controlIndex = 0; controlIndex < count; controlIndex++) {
          const control = controls.nth(controlIndex);
          const descriptor = await control.evaluate(element => ({
            label: (element.getAttribute('aria-label') || '').trim(),
            title: (element.getAttribute('title') || '').trim(),
            text: (element.innerText || element.textContent || '').trim(),
            className: typeof element.className === 'string' ? element.className : '',
            box: (() => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),
          })).catch(() => null);
          if (!descriptor) continue;
          const namedClose = /^(close|关闭|关闭弹窗|关闭窗口)$/i.test(descriptor.label)
            || /^(close|关闭|关闭弹窗|关闭窗口)$/i.test(descriptor.title)
            || /(?:^|[-_\s])(close|dismiss)(?:$|[-_\s])/i.test(descriptor.className);
          const glyph = /^(×|✕|✖|x)$/i.test(descriptor.text);
          const atTopRight = descriptor.box.x + descriptor.box.width / 2 >= dialogBox.x + dialogBox.width * 0.65
            && descriptor.box.y + descriptor.box.height / 2 <= dialogBox.y + dialogBox.height * 0.35;
          if (!namedClose && !(glyph && atTopRight)) continue;
          try {
            await control.click({ timeout: 2000 });
            dismissed++;
            break;
          } catch {
            // A stale or intercepted close control is not permission to click elsewhere.
          }
        }
      }
      if (dialogCount) record('adapter_session', 'popup_check_' + phase, dismissed ? 'dismissed' : 'visible_unresolved');
      return { phase, visible_modal_count: dialogCount, dismissed_count: dismissed };
    };
    context.signal.addEventListener('abort', abort, { once: true });
    try {
      const format = context.expectedArtifacts.length === 1 && typeof context.expectedArtifacts[0] === 'string' && /\.(txt|xlsx)$/i.exec(context.expectedArtifacts[0])?.[1]?.toLowerCase();
      if (!format) throw new Error('task_artifact_contract_unsupported');
      browser = await chromium.launchPersistentContext(process.env[profileEnv], { channel: 'msedge', headless: false, acceptDownloads: true });
      page = browser.pages()[0] ?? await browser.newPage();
      await page.goto('https://yuanbao.tencent.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      popupChecks.push(await dismissModalPopups('initial_load'));
      const modelLabel = context.config.model_label ?? 'Hy4';
      const modeLabel = context.config.mode_label ?? '专家模式';
      await checkpoint('请登录元宝并新建空对话。接下来适配器会打开“切换模型”菜单，选择 ' + modelLabel + ' 的 ' + modeLabel + '；如果菜单无法识别会停止，不会发送任务。');
      operatorConfirmations.push({ item: 'login_and_new_chat', status: 'operator_confirmed' });
      const switcher = page.getByRole('button', { name: '切换模型', exact: true });
      if (await switcher.count() !== 1) throw new Error('model_switcher_ambiguous');
      await switcher.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      const modelEntry = page.locator('[role="menuitem"][aria-label="选择模型"]:visible');
      if (await modelEntry.count() !== 1) throw new Error('model_list_entry_ambiguous');
      await modelEntry.click({ timeout: 5000 });
      await page.waitForTimeout(500);
      const hy4Option = page.locator('[role="menuitemradio"]:visible').filter({ hasText: /^Hy4\s*新升级\s*兼顾日常与复杂任务$/ });
      if (await hy4Option.count() !== 1) throw new Error('hy4_model_option_ambiguous');
      if (await hy4Option.getAttribute('aria-checked') !== 'true') {
        try { await hy4Option.click({ timeout: 5000 }); } catch { /* UI may rerender after accepting the selection. */ }
        await page.waitForTimeout(500);
      }
      if (await hy4Option.getAttribute('aria-checked').catch(() => null) !== 'true') {
        await page.keyboard.press('Escape');
        await switcher.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        const modelEntryRetry = page.locator('[role="menuitem"][aria-label="选择模型"]:visible');
        if (await modelEntryRetry.count() !== 1) throw new Error('hy4_model_selection_unconfirmed');
        await modelEntryRetry.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        const hy4Retry = page.locator('[role="menuitemradio"]:visible').filter({ hasText: /^Hy4\s*新升级\s*兼顾日常与复杂任务$/ });
        if (await hy4Retry.count() !== 1 || await hy4Retry.getAttribute('aria-checked') !== 'true') throw new Error('hy4_model_selection_unconfirmed');
      }
      let expertOption = page.locator('[role="menuitemradio"]:visible').filter({ hasText: /^专家模式\s*使用工具，处理多步任务(?:\s*\(Hy4\))?$/ });
      if (await expertOption.count() !== 1) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        expertOption = page.locator('[role="menuitemradio"]:visible').filter({ hasText: /^专家模式\s*使用工具，处理多步任务(?:\s*\(Hy4\))?$/ });
        if (await expertOption.count() !== 1) {
          await switcher.click({ timeout: 5000 });
          await page.waitForTimeout(500);
          expertOption = page.locator('[role="menuitemradio"]:visible').filter({ hasText: /^专家模式\s*使用工具，处理多步任务(?:\s*\(Hy4\))?$/ });
        }
      }
      if (await expertOption.count() !== 1) throw new Error('expert_hy4_option_ambiguous');
      if (await expertOption.getAttribute('aria-checked') !== 'true') {
        try { await expertOption.click({ timeout: 5000 }); } catch { /* UI may rerender after accepting the selection. */ }
        await page.waitForTimeout(500);
      }
      if (await expertOption.getAttribute('aria-checked').catch(() => null) !== 'true') {
        await page.keyboard.press('Escape');
        await switcher.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        const expertRetry = page.locator('[role="menuitemradio"]:visible').filter({ hasText: /^专家模式\s*使用工具，处理多步任务(?:\s*\(Hy4\))?$/ });
        if (await expertRetry.count() !== 1 || await expertRetry.getAttribute('aria-checked') !== 'true') throw new Error('expert_mode_selection_unconfirmed');
      }
      uiSelections.push({ item: 'model_and_mode', model_label: modelLabel, mode_label: modeLabel, model_ui_selected: true, mode_ui_selected: true, status: 'aria_checked_confirmed', effective_model: 'unknown' });
      record('adapter_session', 'model_mode_selection', 'aria_checked_confirmed');
      await page.keyboard.press('Escape');
      popupChecks.push(await dismissModalPopups('before_attachment'));
      await page.getByRole('button', { name: '添加', exact: true }).click();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.getByText('本地文件', { exact: true }).click()]);
      await chooser.setFiles(context.inputPath);
      popupChecks.push(await dismissModalPopups('after_attachment'));
      await checkpoint('请确认附件已上传完成。');
      record('operator_report', 'attachment_ready', 'confirmed');
      const editor = page.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({ visible: true });
      if (await editor.count() !== 1) throw new Error('editor_ambiguous');
      const visibleMessageSelector = '.hyc-content-text,.ybc-p';
      const baselineMessageTexts = (await page.locator(visibleMessageSelector).filter({ visible: true }).allTextContents()).map(text => text.trim()).filter(Boolean);
      const baselinePromptCount = baselineMessageTexts.filter(text => text === context.prompt.trim()).length;
      await editor.fill(context.prompt);
      await editor.press('Enter');
      popupChecks.push(await dismissModalPopups('after_prompt_submission'));
      let promptObserved = false;
      if (context.config.experimental_auto_checks === true) {
        try {
          await page.waitForFunction(({ expected, previousCount }) => [...document.querySelectorAll('.hyc-content-text,.ybc-p')].filter(e => {
            const rect = e.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (e.innerText || '').trim() === expected;
          }).length > previousCount, { expected: context.prompt.trim(), previousCount: baselinePromptCount }, { timeout: 10000 });
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
      if (format === 'txt' && context.config.experimental_auto_checks === true) {
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
        await checkpoint(`请等待任务完成，并确认对话中本次生成的 ${format.toUpperCase()} 文件卡片已经出现。`);
        record('operator_report', 'completion_and_artifact', 'confirmed');
      }
      visibleResponseBlocks = await page.evaluate(({ expectedPrompt, baselineTexts }) => {
        const visible = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
        const baseline = new Set(baselineTexts);
        return [...document.querySelectorAll('.hyc-content-text,.ybc-p')].filter(visible).map(element => ({
          selector: element.matches('.ybc-p') ? '.ybc-p' : '.hyc-content-text',
          text: (element.innerText || '').trim(),
        })).filter(block => block.text && block.text !== expectedPrompt && !baseline.has(block.text));
      }, { expectedPrompt: context.prompt.trim(), baselineTexts: baselineMessageTexts });
      responseCaptureStatus = visibleResponseBlocks.length ? 'visible_non_prompt_text_candidates' : 'no_new_non_prompt_text_observed';
      if (!visibleResponseBlocks.length) missing.push('visible_response_text_not_captured');
      record('adapter_session', 'visible_response_capture', responseCaptureStatus);
      popupChecks.push(await dismissModalPopups('before_artifact_export'));
      const cards = page.locator(`span[class*="file-card_title"][title$=".${format}" i]:visible`);
      if (await cards.count() !== 1) throw new Error('artifact_card_ambiguous');
      await cards.click({ timeout: 10000 });
      record('adapter_session', 'artifact_preview_click', 'completed');
      const control = page.locator('[aria-label="下载"]:visible');
      await control.first().waitFor({ state: 'visible', timeout: 10000 });
      if (await control.count() !== 1) throw new Error('download_control_ambiguous');
      await control.hover();
      const choice = page.locator('.t-dropdown:visible').getByText(format.toUpperCase(), { exact: true });
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
      await writeFile(path.join(context.runDir, 'yuanbao-web-events.json'), JSON.stringify({ run_id: context.runId, observations, missing, operator_confirmations: operatorConfirmations, ui_selections: uiSelections, popup_checks: popupChecks, response_capture_status: responseCaptureStatus, visible_response_blocks: visibleResponseBlocks }, null, 2) + '\n');
    }
  }
}
