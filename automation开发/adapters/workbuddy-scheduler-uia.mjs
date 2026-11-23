import { appendFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarnessAdapter } from './base.mjs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const execFileAsync = promisify(execFile);
const ENTRY_ID = 'workbuddy-local-scheduler-uia';
const HELPER = fileURLToPath(new URL('../tools/workbuddy-scheduler-uia.ps1', import.meta.url));
const ACTIONS_REF = 'workbuddy-scheduler-uia/actions.jsonl';
const REQUIRED_ROLES = ['open_scheduler', 'new_task', 'task_name', 'prompt', 'workspace', 'single_run', 'save_task', 'run_now', 'read_status'];

function now() { return new Date().toISOString(); }
function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

function selectorConfigured(selector) {
  return selector && (typeof selector.automation_id === 'string' || typeof selector.name === 'string');
}

function render(value, variables) {
  return String(value).replace(/\{\{([a-z_]+)\}\}/gi, (_match, key) => {
    if (!(key in variables)) throw new Error(`Unknown WorkBuddy UIA template variable: ${key}`);
    return variables[key];
  });
}

function wait(ms, signal) {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new Error('aborted'));
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function parseHelperOutput(stdout) {
  const lines = String(stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error('WorkBuddy UIA helper returned no structured output.');
  try { return JSON.parse(lines.at(-1)); }
  catch { throw new Error('WorkBuddy UIA helper returned invalid JSON.'); }
}

async function callHelper({ action, selector, value, commandFile, allowClipboardFallback = false, signal, timeoutMs = 15000 }) {
  if (process.platform !== 'win32') throw new Error('WorkBuddy UIA adapter is available only on Windows.');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', HELPER, '-Action', action];
  if (selector) args.push('-SelectorJson', JSON.stringify(selector));
  if (commandFile) args.push('-CommandFile', commandFile);
  if (allowClipboardFallback) args.push('-AllowClipboardFallback');
  const helperCommand = commandFile && value !== undefined ? JSON.stringify({ value }) : null;
  if (helperCommand) await writeFile(commandFile, helperCommand, 'utf8');
  try {
    const { stdout } = await execFileAsync('powershell.exe', args, {
      windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8', signal,
    });
    return parseHelperOutput(stdout);
  } catch (error) {
    const result = error.stdout ? parseHelperOutput(error.stdout) : null;
    if (result) return result;
    if (signal?.aborted) throw error;
    if (error.killed || error.code === 'ETIMEDOUT') return { status: 'helper_timeout' };
    return { status: 'helper_process_failed', error_code: typeof error.code === 'string' ? error.code : 'unknown' };
  } finally {
    if (commandFile) await unlink(commandFile).catch(() => {});
  }
}

function uniqueTaskName(runId) {
  return `HarnessEval-${runId}`;
}

function buildPrompt(context) {
  const expected = (context.expectedArtifacts ?? [])
    .filter(item => typeof item === 'string' || item.required !== false)
    .map(item => typeof item === 'string' ? item : item.path);
  const workspace = resolve(context.workspaceDir);
  const withinWorkspace = candidate => {
    const rel = relative(workspace, resolve(workspace, candidate));
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  if (!withinWorkspace(context.inputPath)) throw new Error('WorkBuddy input path escapes its isolated workspace.');
  for (const item of expected) if (!withinWorkspace(item)) throw new Error('WorkBuddy expected artifact path escapes its isolated workspace.');
  return [
    context.prompt.trimEnd(),
    '',
    '---',
    'HarnessEval 本地文件交接信息（由适配器注入）',
    `输入文件：${context.inputPath}`,
    `输入文件 SHA-256：${context.inputSha256}`,
    `本轮工作区：${context.workspaceDir}`,
    `产物目录：${context.outputDir}`,
    '只处理上述工作区中的文件；不要覆盖输入文件。',
    ...(expected.length ? ['请将要求的产物保存到以下绝对路径，并确保写入完成后再回复：', ...expected.map(item => `- ${path.resolve(context.workspaceDir, item)}`)] : []),
  ].join('\n');
}

export class WorkBuddySchedulerUiaAdapter extends HarnessAdapter {
  constructor() { super('workbuddy'); }

  snapshotConfig(config = {}) {
    return {
      entry_id: config.entry_id ?? ENTRY_ID,
      execution_method: 'interactive_windows_uia',
      product_process: 'WorkBuddy.exe',
      ui_selector_map_revision: config.ui_selector_map_revision ?? null,
      ui_selector_map_verified: config.ui_selector_map_verified === true,
      selector_values_in_snapshot: false,
      workspace_policy: 'runner_isolated_local_workspace',
      trigger: 'product_ui_run_now',
      poll_interval_seconds: config.poll_interval_seconds ?? 2,
      timeout_seconds: config.timeout_seconds ?? null,
      automation_mode: 'interactive_automatic',
      effective_model: null,
      effective_skills: null,
      effective_permission: null,
    };
  }

  permissionDescription(config = {}) {
    return {
      requested_mode: config.permission_mode ?? 'product_default',
      automatic_permission_response: false,
      note: 'Adapter never changes the WorkBuddy permission mode automatically.',
    };
  }

  preflight(config, { timeoutSeconds } = {}) {
    if (process.platform !== 'win32') return { status: 'not_admitted', missing: ['windows_interactive_desktop'], reason: 'WorkBuddy UIA requires a Windows interactive desktop session.' };
    if (config.entry_id !== ENTRY_ID) return { status: 'not_admitted', missing: ['entry_id'], reason: `Expected ${ENTRY_ID}.` };
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return { status: 'not_admitted', missing: ['timeout_seconds'], reason: 'A positive timeout is required.' };
    if (config.ui_selector_map_verified !== true || !config.ui_selector_map_revision) {
      return { status: 'not_admitted', missing: ['verified_ui_selector_map'], reason: 'WorkBuddy UI controls have not been inspected and frozen; refusing to guess selectors.' };
    }
    if (!config.selectors || REQUIRED_ROLES.some(role => !selectorConfigured(config.selectors[role]))) {
      return { status: 'not_admitted', missing: ['workbuddy_ui_selectors'], reason: `A unique selector is required for each UI role: ${REQUIRED_ROLES.join(', ')}.` };
    }
    if (!Array.isArray(config.workflow) || config.workflow.length === 0) {
      return { status: 'not_admitted', missing: ['workbuddy_ui_workflow'], reason: 'The UI workflow must be explicitly configured and reviewed.' };
    }
    if (config.status_scoped_to_run_id !== true) {
      return { status: 'not_admitted', missing: ['run_scoped_status_selector'], reason: 'The run-status selector must be verified as belonging to the newly created task/run.' };
    }
    if (!Array.isArray(config.success_patterns) || config.success_patterns.length === 0 || !Array.isArray(config.failure_patterns) || config.failure_patterns.length === 0 || !Array.isArray(config.running_patterns) || config.running_patterns.length === 0) {
      return { status: 'not_admitted', missing: ['run_status_patterns'], reason: 'Success, failure, and running-state patterns must be explicitly configured from observed UI text.' };
    }
    try {
      for (const pattern of [...config.success_patterns, ...config.failure_patterns, ...config.running_patterns]) new RegExp(pattern, 'i');
    } catch {
      return { status: 'not_admitted', missing: ['valid_run_status_patterns'], reason: 'A configured WorkBuddy run-status pattern is not a valid regular expression.' };
    }
    const roles = new Set(config.workflow.map(step => step.role));
    if (REQUIRED_ROLES.some(role => !roles.has(role))) {
      return { status: 'not_admitted', missing: ['complete_workbuddy_ui_workflow'], reason: `Workflow must cover: ${REQUIRED_ROLES.join(', ')}.` };
    }
    if (config.workflow.some(step => step.action !== 'wait' && !selectorConfigured(config.selectors[step.selector_key ?? step.role]))) {
      return { status: 'not_admitted', missing: ['workflow_step_selector'], reason: 'Every non-wait UI workflow step must reference a verified unique selector.' };
    }
    const requiredActions = {
      open_scheduler: ['invoke'], new_task: ['invoke'], task_name: ['set-value'], prompt: ['set-value'],
      workspace: ['set-value'], single_run: ['select'], save_task: ['invoke'], run_now: ['invoke'], read_status: ['read'],
    };
    for (const [role, allowed] of Object.entries(requiredActions)) {
      if (!config.workflow.some(step => step.role === role && allowed.includes(step.action))) {
        return { status: 'not_admitted', missing: [`valid_action_for_${role}`], reason: `Workflow role '${role}' must use action: ${allowed.join(' or ')}.` };
      }
    }
    const requiredTemplates = { task_name: '{{task_name}}', prompt: '{{prompt}}', workspace: '{{workspace}}', single_run: '单次' };
    for (const [role, requiredText] of Object.entries(requiredTemplates)) {
      const step = config.workflow.find(item => item.role === role);
      if (typeof step.value_template !== 'string' || !step.value_template.includes(requiredText)) {
        return { status: 'not_admitted', missing: [`verified_value_template_for_${role}`], reason: `Workflow role '${role}' must include the required run-specific value.` };
      }
    }
    return { status: 'ready', missing: [] };
  }

  buildInvocation() { throw new Error('WorkBuddy scheduled-task UIA uses runSession(), not a CLI process invocation.'); }

  async runSession(context) {
    const evidencePath = path.join(context.runDir, ACTIONS_REF);
    await mkdir(path.dirname(evidencePath), { recursive: true });
    const observations = [];
    const missing = ['effective_model', 'effective_mode', 'runtime_skill_state', 'runtime_permission_state', 'internal_trace'];
    const evidenceRefs = [ACTIONS_REF];
    const prompt = buildPrompt(context);
    const promptRef = 'workbuddy-scheduler-uia/submitted-prompt.txt';
    await writeFile(path.join(context.runDir, promptRef), prompt, 'utf8');
    evidenceRefs.push(promptRef);
    const inputEvidence = [{ path: context.inputRelativePath.replaceAll('\\', '/'), sha256: context.inputSha256 }];
    const taskName = uniqueTaskName(context.runId);
    const variables = {
      run_id: context.runId,
      task_name: taskName,
      prompt,
      workspace: context.workspaceDir,
      input_path: context.inputPath,
      output_dir: context.outputDir,
    };
    let promptVerified = false;
    let runTriggered = false;
    const completedRoles = new Set();
    let statusText = '';
    let failure = null;
    const pollSeconds = Math.max(0.5, Math.min(30, Number(context.config.poll_interval_seconds ?? 2)));
    const deadline = Date.now() + context.timeoutSeconds * 1000;

    const record = async item => appendFile(evidencePath, JSON.stringify({ timestamp: now(), ...item }) + '\n', 'utf8');
    const observe = (event, status) => observations.push({ source: 'workbuddy_scheduler_uia', event, status, timestamp: now() });
    const selectorFor = role => {
      const step = typeof role === 'object' ? role : { role };
      const selector = { ...context.config.selectors[step.selector_key ?? step.role] };
      for (const key of ['automation_id', 'name', 'control_type']) if (selector[key]) selector[key] = render(selector[key], variables);
      return selector;
    };
    const runStep = async step => {
      if (step.action === 'wait') {
        await wait(Math.max(0, Math.min(10000, Number(step.milliseconds ?? 250))), context.signal);
        return { status: 'waited' };
      }
      const selector = selectorFor(step);
      if (step.action === 'set-value') {
        const value = render(step.value_template, variables);
        const commandFile = path.join(context.runDir, 'workbuddy-scheduler-uia', `helper-${randomUUID()}.json`);
        const result = await callHelper({ action: 'set-value', selector, value, commandFile, allowClipboardFallback: context.config.allow_clipboard_fallback === true, signal: context.signal });
        if (step.role === 'prompt' && result.status === 'value_set_and_verified') promptVerified = true;
        return result;
      }
      if (step.action === 'select') {
        const value = render(step.value_template, variables);
        const commandFile = path.join(context.runDir, 'workbuddy-scheduler-uia', `helper-${randomUUID()}.json`);
        return callHelper({ action: 'select', selector, value, commandFile, signal: context.signal });
      }
      if (step.action === 'invoke') {
        if (step.role === 'run_now') {
          const requiredBeforeRun = ['open_scheduler', 'new_task', 'task_name', 'prompt', 'workspace', 'single_run', 'save_task'];
          const missingRoles = requiredBeforeRun.filter(role => !completedRoles.has(role));
          if (!promptVerified || missingRoles.length) return { status: 'blocked_preconditions_not_verified', missing_roles: missingRoles };
        }
        const result = await callHelper({ action: 'invoke', selector, signal: context.signal });
        if (step.role === 'run_now' && result.status === 'invoked') runTriggered = true;
        return result;
      }
      if (step.action === 'read') return callHelper({ action: 'read', selector, signal: context.signal });
      return { status: 'unsupported_step_action' };
    };

    try {
      const inspection = await callHelper({ action: 'inspect', signal: context.signal });
      await record({ event: 'ui_inspection', result: inspection });
      if (inspection.status !== 'window_controls_found') {
        observe('window_access', inspection.status ?? 'unknown');
        return {
          submission_status: 'unconfirmed', submission_evidence: { prompt_submitted: false, inputs: [] },
          execution_status: 'failed', completion_evidence: { task_success_verified: false, remote_status: 'interactive_window_unavailable' },
          observations, missing: [...missing, 'workbuddy_interactive_window'], evidence_refs: evidenceRefs,
          error: { code: 'workbuddy_interactive_window_unavailable', phase: 'preflight' },
        };
      }
      observe('window_access', 'accessible');

      for (const step of context.config.workflow) {
        if (context.signal.aborted) throw new Error('aborted');
        if (step.role === 'read_status') break;
        const result = await runStep(step);
        await record({ event: 'workflow_step', role: step.role, action: step.action, result });
        if (!['waited', 'invoked', 'value_set_and_verified', 'selected_and_verified'].includes(result.status)) {
          failure = result.status;
          observe(step.role, result.status ?? 'failed');
          break;
        }
        completedRoles.add(step.role);
        observe(step.role, 'completed');
      }

      if (runTriggered && !failure) {
        observe('run_now', 'triggered');
        const statusStep = context.config.workflow.find(step => step.role === 'read_status');
        const successPatterns = (context.config.success_patterns ?? []).map(pattern => new RegExp(pattern, 'i'));
        const failurePatterns = (context.config.failure_patterns ?? []).map(pattern => new RegExp(pattern, 'i'));
        const runningPatterns = (context.config.running_patterns ?? []).map(pattern => new RegExp(pattern, 'i'));
        while (!context.signal.aborted && Date.now() < deadline) {
          const result = await runStep(statusStep);
          statusText = String(result.text ?? '');
          await record({ event: 'run_status_poll', result: { status: result.status, text: statusText } });
          if (failurePatterns.some(pattern => pattern.test(statusText))) { failure = 'product_reported_failure'; break; }
          if (successPatterns.some(pattern => pattern.test(statusText))) { failure = null; break; }
          if (result.status !== 'read' || !runningPatterns.some(pattern => pattern.test(statusText))) {
            failure = 'run_status_unrecognized';
            break;
          }
          await wait(pollSeconds * 1000, context.signal);
        }
        if (Date.now() >= deadline && !failure) failure = 'timed_out';
      }
    } catch (error) {
      failure = context.signal.aborted ? 'timed_out' : error.message;
      await record({ event: 'adapter_error', error_code: context.signal.aborted ? 'timeout' : 'uia_operation_failed' });
    }

    const successPatterns = (context.config.success_patterns ?? []).map(pattern => new RegExp(pattern, 'i'));
    const statusIsSuccess = statusText.length > 0 && successPatterns.some(pattern => pattern.test(statusText));
    const submissionStatus = runTriggered && promptVerified ? 'submitted' : 'unconfirmed';
    const executionStatus = failure === 'timed_out' ? 'timed_out' : failure ? 'failed' : statusIsSuccess ? 'completed' : 'unknown';
    return {
      submission_status: submissionStatus,
      submission_evidence: { prompt_submitted: submissionStatus === 'submitted', prompt_ref: promptRef, inputs: submissionStatus === 'submitted' ? inputEvidence : [] },
      execution_status: executionStatus,
      completion_evidence: { task_success_verified: false, remote_status: statusIsSuccess ? 'product_ui_reported_success' : failure ?? 'unconfirmed' },
      observations,
      missing: [...missing, 'task_success_not_independently_verified'],
      evidence_refs: evidenceRefs,
      error: failure ? { code: `workbuddy_scheduler_uia_${String(failure).replace(/[^a-z0-9_]+/gi, '_').toLowerCase()}`, phase: runTriggered ? 'observe' : 'execute' } : null,
    };
  }
}
