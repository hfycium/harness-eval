import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HarnessAdapter } from './base.mjs';
import { WorkBuddySchedulerUiaAdapter } from './workbuddy-scheduler-uia.mjs';
import { WorkBuddyQueueAdapter } from './workbuddy-connector-queue.mjs';

const API_ROOT = 'https://www.workbuddy.cn/openapi/v2';
const ACCESS_TOKEN_ENV = 'WORKBUDDY_ACCESS_TOKEN';
const WORKSPACE_ROOT_ENV = 'HARNESS_EVAL_WORKBUDDY_ROOT';
const CREDENTIAL_SCRIPT = fileURLToPath(new URL('../tools/workbuddy-credential.ps1', import.meta.url));
const CREDENTIAL_FILE = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'HarnessEval', 'workbuddy-token.xml');
const EVIDENCE_REF = 'workbuddy-openapi/messages.jsonl';
const SCHEDULER_ENTRY_ID = 'workbuddy-local-scheduler-uia';

function hasCredential() {
  return Boolean(process.env[ACCESS_TOKEN_ENV]) || (process.platform === 'win32' && existsSync(CREDENTIAL_FILE));
}

function loadCredential() {
  if (process.env[ACCESS_TOKEN_ENV]) return process.env[ACCESS_TOKEN_ENV];
  if (process.platform !== 'win32' || !existsSync(CREDENTIAL_FILE)) return null;
  try {
    const encoded = execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', CREDENTIAL_SCRIPT, '-Action', 'get',
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 32 * 1024 }).trim();
    const token = Buffer.from(encoded, 'base64').toString('utf8');
    return token || null;
  } catch {
    const error = new Error('WorkBuddy DPAPI credential could not be read for this Windows user.');
    error.code = 'credential_unavailable';
    throw error;
  }
}

export function resolveWorkBuddyWorkspaceRoot() {
  return process.env[WORKSPACE_ROOT_ENV] || path.join(os.homedir(), 'Documents', 'HarnessEval-WorkBuddy');
}

function timestamp() { return new Date().toISOString(); }
function pollIntervalMs(value) {
  const seconds = Number(value ?? 2);
  return Number.isFinite(seconds) ? Math.max(500, Math.min(30000, seconds * 1000)) : 2000;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function expectedArtifactPaths(context) {
  return (context.expectedArtifacts ?? [])
    .filter(item => typeof item === 'string' || item.required !== false)
    .map(item => typeof item === 'string' ? item : item.path);
}

function taskPrompt(context) {
  const artifactPaths = expectedArtifactPaths(context);
  for (const relative of artifactPaths) {
    if (typeof relative !== 'string' || !isWithin(context.workspaceDir, path.resolve(context.workspaceDir, relative))) {
      throw new Error('Expected artifact path escapes WorkBuddy workspace.');
    }
  }
  if (!isWithin(context.workspaceDir, context.inputPath)) throw new Error('Input path escapes WorkBuddy workspace.');
  const lines = [
    context.prompt.trimEnd(),
    '',
    '---',
    'HarnessEval 本地文件交接信息（由适配器自动注入）',
    `输入文件：${context.inputPath}`,
    `输入文件 SHA-256：${context.inputSha256}`,
    `本轮工作区：${context.workspaceDir}`,
    `产物目录：${context.outputDir}`,
  ];
  if (artifactPaths.length) {
    lines.push('请将要求的产物保存到以下绝对路径，并确保文件写入完成后再回复：');
    for (const relative of artifactPaths) lines.push(`- ${path.resolve(context.workspaceDir, relative)}`);
  }
  lines.push('只处理上述工作区中的文件；不要覆盖输入文件。输入文件通过本机路径引用，不是 API 附件上传。');
  return lines.join('\n');
}

async function waitForExpectedArtifacts(context, intervalMs) {
  const paths = expectedArtifactPaths(context);
  if (paths.length === 0) return true;
  let previous = null;
  while (!context.signal.aborted) {
    const current = [];
    let allPresent = true;
    for (const relative of paths) {
      const target = path.resolve(context.workspaceDir, relative);
      if (!isWithin(context.workspaceDir, target)) throw new Error('Expected artifact path escapes WorkBuddy workspace.');
      try {
        const info = await stat(target);
        if (!info.isFile()) { allPresent = false; break; }
        current.push({ path: relative, size: info.size, mtimeMs: info.mtimeMs });
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        allPresent = false;
        break;
      }
    }
    if (allPresent && previous && JSON.stringify(current) === JSON.stringify(previous)) return true;
    previous = allPresent ? current : null;
    await wait(intervalMs, context.signal);
  }
  return false;
}

async function wait(ms, signal) {
  if (signal.aborted) throw new Error('aborted');
  await new Promise((resolve, reject) => {
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

async function requestJson(url, { token, method = 'GET', body, signal }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const safe = new Error('WorkBuddy Open API request failed before an HTTP response.');
    safe.code = 'network_error';
    throw safe;
  }
  let payload;
  try { payload = await response.json(); }
  catch {
    const safe = new Error('WorkBuddy Open API returned a non-JSON response.');
    safe.code = 'invalid_json';
    safe.httpStatus = response.status;
    throw safe;
  }
  return { httpStatus: response.status, payload };
}

function apiSucceeded(result) {
  return result.httpStatus >= 200 && result.httpStatus < 300 && (result.payload?.code === 0 || result.payload?.code === '0');
}

function safeMessage(message, token) {
  const redact = text => token ? text.split(token).join('[REDACTED]') : text;
  const content = Array.isArray(message.content)
    ? message.content.map(part => {
        if (typeof part === 'string') return redact(part);
        if (part && typeof part === 'object' && typeof part.text === 'string') return { type: part.type ?? 'text', text: redact(part.text) };
        return { type: part?.type ?? 'unsupported_content' };
      })
    : [];
  return {
    message_id: typeof message.message_id === 'string' ? message.message_id : null,
    role: typeof message.role === 'string' ? message.role : 'unknown',
    msg_type: typeof message.msg_type === 'string' ? message.msg_type : typeof message.metadata?.msgType === 'string' ? message.metadata.msgType : null,
    created_at: typeof message.created_at === 'string' ? message.created_at : null,
    content,
    attachment_count: Array.isArray(message.attachments) ? message.attachments.length : null,
  };
}

export class WorkBuddyAdapter extends HarnessAdapter {
  constructor() { super('workbuddy'); }

  isSchedulerEntry(config) { return config?.entry_id === SCHEDULER_ENTRY_ID; }
  isQueueEntry(config) { return config?.entry_id === 'workbuddy-connector-queue'; }

  snapshotConfig(config, { environment = {} } = {}) {
    if (this.isQueueEntry(config)) return new WorkBuddyQueueAdapter().snapshotConfig(config);
    if (this.isSchedulerEntry(config)) return new WorkBuddySchedulerUiaAdapter().snapshotConfig(config, { environment });
    return {
      entry_id: config.entry_id ?? 'workbuddy-localassistant-openapi',
      execution_method: 'official_localassistant_openapi',
      api_root: API_ROOT,
      access_token_env: ACCESS_TOKEN_ENV,
      credential_source: environment[ACCESS_TOKEN_ENV] ? 'process_environment' : process.platform === 'win32' && existsSync(CREDENTIAL_FILE) ? 'windows_current_user_dpapi' : 'missing',
      access_token_present: hasCredential(),
      workspace_root_env: WORKSPACE_ROOT_ENV,
      workspace_root_source: environment[WORKSPACE_ROOT_ENV] ? 'per_machine_environment_override' : 'user_documents_default',
      local_workspace_access: 'unknown_until_product_smoke',
      input_delivery: 'absolute_local_path_reference_in_text_message',
      file_artifact_collection: 'shared_isolated_workspace',
      poll_interval_seconds: config.poll_interval_seconds ?? 2,
      timeout_seconds: config.timeout_seconds ?? null,
      automation_mode: 'automatic',
    };
  }

  permissionDescription(config) {
    if (this.isQueueEntry(config)) return new WorkBuddyQueueAdapter().permissionDescription();
    if (this.isSchedulerEntry(config)) return new WorkBuddySchedulerUiaAdapter().permissionDescription(config);
    return {
      required_scopes: ['user.localassistant.readable', 'user.localassistant.invokable'],
      runtime_scope_confirmation: 'unknown',
      automatic_permission_response: false,
    };
  }

  preflight(config, { timeoutSeconds, environment = {}, task } = {}) {
    if (this.isQueueEntry(config)) return new WorkBuddyQueueAdapter().preflight(config, { timeoutSeconds });
    if (this.isSchedulerEntry(config)) return new WorkBuddySchedulerUiaAdapter().preflight(config, { timeoutSeconds, environment, task });
    const missing = [];
    if (config.entry_id !== 'workbuddy-localassistant-openapi') missing.push('entry_id');
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) missing.push('timeout_seconds');
    if (config.workspace_root_env !== WORKSPACE_ROOT_ENV) missing.push('workspace_root_env');
    if (!hasCredential()) missing.push('workbuddy_access_token');
    return missing.length
      ? {
          status: 'not_admitted', missing,
          reason: 'WorkBuddy local-assistant API mode requires its official entry ID, an access token, and a positive timeout.',
        }
      : { status: 'ready', missing: [] };
  }

  buildInvocation() {
    throw new Error('WorkBuddy local-assistant API execution uses runSession(), not a CLI process invocation.');
  }

  async runSession(context) {
    if (this.isQueueEntry(context.config)) return new WorkBuddyQueueAdapter().runSession(context);
    if (this.isSchedulerEntry(context.config)) return new WorkBuddySchedulerUiaAdapter().runSession(context);
    const evidencePath = path.join(context.runDir, EVIDENCE_REF);
    await mkdir(path.dirname(evidencePath), { recursive: true });
    const observations = [];
    const missing = ['effective_model', 'effective_mode', 'runtime_skill_state', 'runtime_permission_state', 'internal_trace'];
    const record = async entry => appendFile(evidencePath, JSON.stringify({ timestamp: timestamp(), ...entry }) + '\n', 'utf8');
    const observe = (event, status) => observations.push({ source: 'workbuddy_openapi', event, status, timestamp: timestamp() });
    const evidence = [EVIDENCE_REF];
    const prompt = taskPrompt(context);
    const promptRef = 'workbuddy-openapi/submitted-prompt.txt';
    await writeFile(path.join(context.runDir, promptRef), prompt, 'utf8');
    evidence.push(promptRef);
    const inputEvidence = [{ path: context.inputRelativePath.replaceAll('\\', '/'), sha256: context.inputSha256 }];
    let submittedMessageId = null;

    try {
      const token = loadCredential();
      if (!token) throw Object.assign(new Error('WorkBuddy credential is unavailable.'), { code: 'credential_unavailable' });
      const online = await requestJson(`${API_ROOT}/localassistant`, { token, signal: context.signal });
      await record({ endpoint: '/localassistant', method: 'GET', http_status: online.httpStatus, business_code: online.payload?.code ?? null });
      if (!apiSucceeded(online) || online.payload?.data?.online !== true) {
        observe('localassistant_online_check', online.payload?.data?.online === false ? 'offline' : 'unconfirmed');
        return {
          submission_status: 'failed', submission_evidence: { prompt_submitted: false, inputs: [] },
          execution_status: 'failed', completion_evidence: { task_success_verified: false, remote_status: 'localassistant_unavailable' },
          observations, missing: [...missing, 'localassistant_online_status'], evidence_refs: evidence,
          error: { code: 'workbuddy_localassistant_unavailable', phase: 'preflight' },
        };
      }
      observe('localassistant_online_check', 'online');

      const submitted = await requestJson(`${API_ROOT}/localassistant/message`, {
        token, method: 'POST', body: { content: prompt, msg_type: 'text' }, signal: context.signal,
      });
      const messageId = submitted.payload?.data?.message_id;
      await record({ endpoint: '/localassistant/message', method: 'POST', http_status: submitted.httpStatus, business_code: submitted.payload?.code ?? null, message_id: typeof messageId === 'string' ? messageId : null });
      if (!apiSucceeded(submitted) || typeof messageId !== 'string' || messageId.length === 0) {
        observe('message_submission', 'failed');
        return {
          submission_status: 'failed', submission_evidence: { prompt_submitted: false, inputs: [] },
          execution_status: 'failed', completion_evidence: { task_success_verified: false },
          observations, missing: [...missing, 'message_id'], evidence_refs: evidence,
          error: { code: 'workbuddy_message_submission_failed', phase: 'submit' },
        };
      }
      submittedMessageId = messageId;
      observe('message_submission', 'accepted');

      const intervalMs = pollIntervalMs(context.config.poll_interval_seconds);
      while (!context.signal.aborted) {
        const historyUrl = new URL(`${API_ROOT}/localassistant/message`);
        historyUrl.searchParams.set('message_id', messageId);
        const history = await requestJson(historyUrl, { token, signal: context.signal });
        if (!apiSucceeded(history) || !Array.isArray(history.payload?.data?.messages)) {
          await record({ endpoint: '/localassistant/message', method: 'GET', http_status: history.httpStatus, business_code: history.payload?.code ?? null, after_message_id: messageId, result: 'history_query_failed' });
          observe('message_history_poll', 'failed');
          return {
            submission_status: 'submitted', submission_evidence: { prompt_submitted: true, prompt_ref: promptRef, inputs: inputEvidence },
            execution_status: 'failed', completion_evidence: { task_success_verified: false },
            observations, missing: [...missing, 'assistant_reply'], evidence_refs: evidence,
            error: { code: 'workbuddy_history_query_failed', phase: 'observe' },
          };
        }
        const messages = history.payload.data.messages.filter(message => message?.role === 'assistant');
        for (const message of messages) await record({ endpoint: '/localassistant/message', method: 'GET', http_status: history.httpStatus, after_message_id: messageId, message: safeMessage(message, token) });
        if (messages.length > 0) {
          const needsAction = messages.some(message => /ask.?question|permission|approval/i.test(String(message.msg_type ?? message.metadata?.msgType ?? '')));
          if (needsAction) {
            observe('assistant_reply', 'requires_action');
            return {
              submission_status: 'submitted', submission_evidence: { prompt_submitted: true, prompt_ref: promptRef, inputs: inputEvidence },
              execution_status: 'requires_action',
              completion_evidence: { task_success_verified: false, remote_status: 'requires_action' },
              observations, missing: [...missing, 'permission_or_question_response_not_automated'], evidence_refs: evidence,
              error: { code: 'workbuddy_requires_operator_action', phase: 'execute' },
            };
          }
          observe('assistant_reply', 'observed');
          const artifactsStable = await waitForExpectedArtifacts(context, intervalMs);
          if (!artifactsStable) break;
          observe('expected_artifacts', expectedArtifactPaths(context).length ? 'stable_in_shared_workspace' : 'not_required');
          return {
            submission_status: 'submitted', submission_evidence: { prompt_submitted: true, prompt_ref: promptRef, inputs: inputEvidence },
            execution_status: 'completed',
            completion_evidence: { task_success_verified: false, remote_status: expectedArtifactPaths(context).length ? 'reply_and_artifacts_observed' : 'assistant_response_observed' },
            observations, missing: [...missing, 'task_success_not_independently_verified'], evidence_refs: evidence,
            error: null,
          };
        }
        await wait(intervalMs, context.signal);
      }
    } catch (error) {
      if (context.signal.aborted) throw error;
      observe('workbuddy_api_error', error.code ?? 'request_failed');
      await record({ endpoint: 'localassistant', result: 'request_failed', safe_code: error.code ?? 'request_failed', http_status: error.httpStatus ?? null });
      return {
        submission_status: submittedMessageId ? 'submitted' : 'unconfirmed',
        submission_evidence: submittedMessageId
          ? { prompt_submitted: true, prompt_ref: promptRef, inputs: inputEvidence }
          : { prompt_submitted: false, inputs: [] },
        execution_status: 'failed', completion_evidence: { task_success_verified: false },
        observations, missing: [...missing, 'api_response'], evidence_refs: evidence,
        error: { code: 'workbuddy_api_request_failed', phase: 'execute' },
      };
    }
    return {
      submission_status: 'submitted', submission_evidence: { prompt_submitted: true, prompt_ref: promptRef, inputs: inputEvidence },
      execution_status: 'timed_out', completion_evidence: { task_success_verified: false },
      observations, missing: [...missing, 'assistant_reply'], evidence_refs: evidence,
      error: { code: 'workbuddy_api_timeout', phase: 'observe' },
    };
  }
}
