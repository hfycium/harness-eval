#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, link, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { withClaimLock } from './queue-lifecycle.mjs';

const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let QUEUE_ROOT = process.env.HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT;
let WORKSPACE_ROOT = process.env.HARNESS_EVAL_WORKBUDDY_ROOT;
const MAX_LINE_BYTES = 1024 * 1024;

function error(code, message) { return Object.assign(new Error(message), { code }); }
function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function isoNow() { return new Date().toISOString(); }
function safeId(value, name = 'run_id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value)) throw error('invalid_argument', `${name} is invalid.`);
  return value;
}
function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}
function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

async function ensureRoots() {
  if (!QUEUE_ROOT || !path.isAbsolute(QUEUE_ROOT)) throw error('configuration_error', 'HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT must be an absolute path.');
  if (!WORKSPACE_ROOT || !path.isAbsolute(WORKSPACE_ROOT)) throw error('configuration_error', 'HARNESS_EVAL_WORKBUDDY_ROOT must be an absolute path.');
  const queue = path.resolve(QUEUE_ROOT);
  const workspace = path.resolve(WORKSPACE_ROOT);
  if (queue === path.parse(queue).root || workspace === path.parse(workspace).root || isInside(ROOT, queue) || isInside(ROOT, workspace) || isInside(queue, ROOT) || isInside(queue, workspace) || isInside(workspace, queue)) {
    throw error('configuration_error', 'Queue and authorized workspace roots must be dedicated directories outside the project repository and filesystem root.');
  }
  for (const name of ['queue/pending', 'queue/claimed', 'queue/results', 'queue/events', 'queue/locks']) await mkdir(path.join(queue, name), { recursive: true });
  QUEUE_ROOT = await realpath(queue);
  WORKSPACE_ROOT = await realpath(workspace);
  const projectReal = await realpath(ROOT);
  if (isInside(projectReal, QUEUE_ROOT) || isInside(projectReal, WORKSPACE_ROOT) || isInside(QUEUE_ROOT, projectReal) ||
      isInside(QUEUE_ROOT, WORKSPACE_ROOT) || isInside(WORKSPACE_ROOT, QUEUE_ROOT)) {
    throw error('configuration_error', 'Resolved queue and workspace roots must be separate dedicated directories outside the project repository.');
  }
}

async function appendEvent(runId, event) {
  const file = path.join(QUEUE_ROOT, 'queue', 'events', `${safeId(runId)}.jsonl`);
  await appendFile(file, `${JSON.stringify({ timestamp: isoNow(), source: 'mcp_connector_server', run_id: runId, ...event })}\n`, 'utf8');
}

async function appendGlobalEvent(event) {
  const file = path.join(QUEUE_ROOT, 'queue', 'events', 'connector.jsonl');
  await appendFile(file, `${JSON.stringify({ timestamp: isoNow(), source: 'mcp_connector_server', ...event })}\n`, 'utf8');
}

async function validateTask(task, fileName) {
  const runId = safeId(task?.run_id);
  let workspace;
  try { workspace = await realpath(task?.workspace_dir); }
  catch { throw error('invalid_task', 'Task workspace does not exist.'); }
  const allowedKeys = new Set(['run_id', 'case_id', 'prompt', 'prompt_sha256', 'workspace_dir', 'inputs', 'expected_artifacts', 'timeout_seconds', 'task_sha256', 'status', 'queued_at']);
  if (!task || Object.keys(task).some(key => !allowedKeys.has(key))) throw error('invalid_task', 'Queued task contains unsupported fields.');
  const { task_sha256: storedTaskHash, ...taskWithoutHash } = task;
  if (`${runId}.json` !== fileName || typeof task.case_id !== 'string' || !task.case_id || typeof task.prompt !== 'string' || !task.prompt ||
      typeof task.prompt_sha256 !== 'string' || sha256(task.prompt) !== task.prompt_sha256 || typeof task.workspace_dir !== 'string' ||
      !path.isAbsolute(task.workspace_dir) || !isInside(WORKSPACE_ROOT, workspace) || workspace === WORKSPACE_ROOT ||
      !Array.isArray(task.inputs) || !Array.isArray(task.expected_artifacts) || !Number.isInteger(task.timeout_seconds) || task.timeout_seconds < 1 || task.status !== 'queued' ||
      typeof task.queued_at !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(task.queued_at) || typeof storedTaskHash !== 'string' || sha256(JSON.stringify(taskWithoutHash)) !== storedTaskHash) {
    throw error('invalid_task', 'Queued task contract is invalid.');
  }
  for (const input of task.inputs) {
    if (typeof input?.path !== 'string' || path.isAbsolute(input.path) || input.path.includes(':') || input.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw error('invalid_task', 'Queued task input is invalid.');
    const candidate = path.resolve(workspace, input.path);
    const actualPath = await realpath(candidate);
    if (!isInside(workspace, actualPath) || sha256(await readFile(actualPath)) !== input.sha256) throw error('input_changed', 'Input is missing, changed, or resolves outside the task workspace.');
  }
  const seen = new Set();
  for (const value of task.expected_artifacts) {
    const item = typeof value === 'string' ? { path: value } : value;
    if (!item || Object.keys(item).some(key => !['path', 'required'].includes(key)) || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.includes(':') || item.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || (item.required !== undefined && typeof item.required !== 'boolean') || seen.has(item.path)) {
      throw error('invalid_task', 'Queued task expected artifact is invalid.');
    }
    seen.add(item.path);
  }
}

async function loadClaimed(runId) {
  const id = safeId(runId);
  const file = path.join(QUEUE_ROOT, 'queue', 'claimed', `${id}.json`);
  try { return { file, record: JSON.parse(await readFile(file, 'utf8')) }; }
  catch (cause) {
    if (cause.code === 'ENOENT') throw error('not_claimed', 'No claimed task exists for this run_id.');
    if (cause instanceof SyntaxError) throw error('queue_corrupt', 'Claimed task record is invalid JSON.');
    throw cause;
  }
}

async function claimNextTask(requestId) {
  const pending = path.join(QUEUE_ROOT, 'queue', 'pending');
  const names = (await readdir(pending)).filter(name => name.endsWith('.json')).sort();
  for (const name of names) {
    const source = path.join(pending, name);
    let task;
    try { task = JSON.parse(await readFile(source, 'utf8')); }
    catch (cause) {
      if (cause.code === 'ENOENT') continue;
      const corruptId = name.slice(0, -5);
      await appendEvent(corruptId, { event: 'claim_rejected', status: 'queue_corrupt' }).catch(() => {});
      continue;
    }
    const runId = safeId(task.run_id);
    if (`${runId}.json` !== name) continue;
    try { await validateTask(task, name); }
    catch (cause) {
      await appendEvent(runId, { event: 'claim_rejected', status: cause.code ?? 'invalid_task' }).catch(() => {});
      continue;
    }
    const attempt = await withClaimLock(QUEUE_ROOT, runId, async () => {
      const claimPath = path.join(QUEUE_ROOT, 'queue', 'claimed', name);
      try {
        const current = JSON.parse(await readFile(source, 'utf8'));
        if (current.task_sha256 !== task.task_sha256) throw error('queue_changed', 'Task changed before claim.');
        await link(source, claimPath);
        await unlink(source);
      } catch (cause) {
        if (cause.code === 'EEXIST') return { status: 'already_claimed', run_id: runId };
        if (cause.code === 'ENOENT') return { status: 'not_found' };
        throw cause;
      }
      const claim = { ...task, status: 'claimed', claimed_at: isoNow(), claim_token: randomUUID() };
      const temporary = `${claimPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(claim, null, 2)}\n`, { flag: 'wx' });
      await rename(temporary, claimPath);
      await appendEvent(runId, { event: 'claim', method: 'claim_next_task', request_id: requestId, status: 'claimed', task_sha256: task.task_sha256 ?? null });
      return publicTask(claim);
    });
    if (attempt.status === 'locked' || attempt.status === 'not_found') continue;
    return attempt;
  }
  return { status: 'empty' };
}

function publicTask(task) {
  return {
    status: 'claimed', run_id: task.run_id, case_id: task.case_id,
    prompt: task.prompt, prompt_sha256: task.prompt_sha256,
    workspace_dir: task.workspace_dir,
    inputs: task.inputs, expected_artifacts: task.expected_artifacts,
    timeout_seconds: task.timeout_seconds,
    connector_notice: 'This MCP connector logs its own calls only; it is not an internal WorkBuddy trace.',
  };
}

async function inspectArtifacts(task, submittedPaths) {
  if (!Array.isArray(submittedPaths) || submittedPaths.length > 32) throw error('invalid_argument', 'artifact_paths must be an array of at most 32 paths.');
  const expected = new Set(task.expected_artifacts.map(item => typeof item === 'string' ? item : item.path));
  const realWorkspace = await realpath(task.workspace_dir);
  const seen = new Set();
  const artifacts = [];
  for (const rel of submittedPaths) {
    if (typeof rel !== 'string' || path.isAbsolute(rel) || rel.includes(':') || rel.split(/[\\/]/).some(part => !part || part === '..' || part === '.')) throw error('path_rejected', 'Artifact paths must be normalized relative paths.');
    const normalized = rel.replaceAll('\\', '/');
    if (!expected.has(normalized) || seen.has(normalized)) throw error('path_rejected', 'Artifact path is not an expected unique path for this run.');
    seen.add(normalized);
    const full = path.resolve(realWorkspace, normalized);
    if (!isInside(realWorkspace, full)) throw error('path_rejected', 'Artifact path escapes its task workspace.');
    const actualPath = await realpath(full);
    if (!isInside(realWorkspace, actualPath)) throw error('path_rejected', 'Artifact resolves outside its task workspace.');
    const info = await stat(actualPath);
    if (!info.isFile()) throw error('artifact_not_file', 'Expected artifact is not a regular file.');
    const bytes = await readFile(actualPath);
    artifacts.push({ path: normalized, size_bytes: info.size, sha256: sha256(bytes), observation: 'connector_process_filesystem_stat' });
  }
  for (const rel of expected) {
    const declaration = task.expected_artifacts.find(item => (typeof item === 'string' ? item : item.path) === rel);
    if (typeof declaration === 'string' || declaration.required !== false) {
      if (!seen.has(rel)) throw error('artifact_missing', `Required artifact was not submitted: ${rel}`);
    }
  }
  return artifacts;
}

async function writeResult(runId, result) {
  const target = path.join(QUEUE_ROOT, 'queue', 'results', `${safeId(runId)}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  try {
    await link(temporary, target);
    await unlink(temporary);
  }
  catch (cause) { await unlink(temporary).catch(() => {}); throw cause; }
}

async function submitResult(args) {
  const runId = safeId(args.run_id);
  const lockPath = path.join(QUEUE_ROOT, 'queue', 'locks', `${runId}.lock`);
  try { await mkdir(lockPath); }
  catch (cause) {
    if (cause.code === 'EEXIST') throw error('run_locked', 'Another submission is being processed or requires manual recovery.');
    throw cause;
  }
  try {
    const { file, record } = await loadClaimed(runId);
    if (record.status !== 'claimed') throw error('already_finalized', 'This run is already finalized.');
    if (!['submitted', 'blocked'].includes(args.status)) throw error('invalid_argument', 'status must be submitted or blocked.');
    const summaryText = args.status === 'blocked' ? args.reason : args.summary;
    if (summaryText !== undefined && (typeof summaryText !== 'string' || summaryText.length > 4000)) throw error('invalid_argument', 'summary/reason must be text of at most 4000 characters.');
    const summary = summaryText ?? '';
    const artifacts = args.status === 'submitted' ? await inspectArtifacts(record, args.artifact_paths ?? []) : [];
    const result = {
      run_id: runId, case_id: record.case_id, status: args.status,
      agent_claimed: { summary, status: args.status, submitted_at: isoNow() },
      artifacts_observed_by_connector: artifacts,
      independent_task_verification: 'pending',
    };
    await writeResult(runId, result);
    const finalized = { ...record, status: args.status, finalized_at: result.agent_claimed.submitted_at };
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(finalized, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, file);
    await appendEvent(runId, {
      event: args.status === 'blocked' ? 'report_blocked' : 'submit_result', status: args.status,
      summary_sha256: sha256(summary), summary_length: summary.length,
      artifact_count: artifacts.length, artifacts,
    });
    return { status: args.status, run_id: runId, artifacts, independent_task_verification: 'pending' };
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

const TOOLS = [
  {
    name: 'claim_next_task', description: 'Atomically claim one queued HarnessEval task. If the queue is empty, return status empty and stop this scheduled run.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'submit_result', description: 'Submit the result for the currently claimed run. Use only expected artifact paths returned by claim_next_task. Your summary is recorded as an agent claim and does not verify task correctness.',
    inputSchema: {
      type: 'object', required: ['run_id', 'status'], additionalProperties: false,
      properties: {
        run_id: { type: 'string' }, status: { type: 'string', enum: ['submitted', 'blocked'] },
        summary: { type: 'string', maxLength: 4000 }, artifact_paths: { type: 'array', maxItems: 32, items: { type: 'string' } },
      },
    },
  },
  {
    name: 'report_blocked', description: 'Mark a claimed run blocked when required input, permissions, or safe completion is unavailable. Do not retry automatically.',
    inputSchema: {
      type: 'object', required: ['run_id', 'reason'], additionalProperties: false,
      properties: { run_id: { type: 'string' }, reason: { type: 'string', maxLength: 1000 } },
    },
  },
];

async function callTool(request) {
  const { name, arguments: args = {} } = request.params ?? {};
  const runId = typeof args.run_id === 'string' ? args.run_id : null;
  const requestId = request.id ?? null;
  const safeArguments = { ...args };
  delete safeArguments.summary;
  delete safeArguments.reason;
  const requestEvent = { event: 'tool_request', method: name, request_id: requestId, run_id: runId, arguments: safeArguments };
  await appendGlobalEvent(requestEvent);
  if (runId) await appendEvent(runId, requestEvent);
  try {
    let result;
    if (name === 'claim_next_task') result = await claimNextTask(requestId);
    else if (name === 'submit_result') result = await submitResult(args);
    else if (name === 'report_blocked') result = await submitResult({ ...args, status: 'blocked', summary: args.reason, artifact_paths: [] });
    else throw error('unknown_tool', 'Unknown tool name.');
    const serialized = JSON.stringify(result);
    const responseEvent = { event: 'tool_response', method: name, request_id: requestId, run_id: result.run_id ?? runId, status: result.status ?? 'ok', response_sha256: sha256(serialized) };
    await appendGlobalEvent(responseEvent);
    if (result.run_id ?? runId) await appendEvent(result.run_id ?? runId, responseEvent);
    return { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: serialized }], structuredContent: result, isError: false } };
  } catch (cause) {
    const result = { status: 'error', code: cause.code ?? 'internal_error', message: cause.message };
    const responseEvent = { event: 'tool_response', method: name, request_id: requestId, run_id: runId, status: result.code, response_sha256: sha256(JSON.stringify(result)) };
    await appendGlobalEvent(responseEvent).catch(() => {});
    if (runId) await appendEvent(runId, responseEvent).catch(() => {});
    return { jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true } };
  }
}

async function handle(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return jsonRpcError(request?.id, -32600, 'Invalid JSON-RPC request.');
  if (request.method === 'initialize') {
    const requested = request.params?.protocolVersion;
    if (!PROTOCOL_VERSIONS.has(requested)) return jsonRpcError(request.id, -32602, 'Unsupported MCP protocol version.');
    return {
      jsonrpc: '2.0', id: request.id,
      result: {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: 'harness-eval-workbuddy-queue', version: '0.1.0' },
      },
    };
  }
  if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') return null;
  if (request.method === 'ping') return { jsonrpc: '2.0', id: request.id, result: {} };
  if (request.method === 'tools/list') return { jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } };
  if (request.method === 'tools/call') return callTool(request);
  if (request.id === undefined) return null;
  return jsonRpcError(request.id, -32601, 'Method not found.');
}

async function main() {
  await ensureRoots();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of input) {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      send(jsonRpcError(null, -32700, 'Message exceeds the configured limit.'));
      continue;
    }
    let request;
    try { request = JSON.parse(line); }
    catch { send(jsonRpcError(null, -32700, 'Parse error.')); continue; }
    try {
      const response = await handle(request);
      if (response) send(response);
    } catch (cause) {
      send(jsonRpcError(request?.id, -32603, cause.code ?? 'Internal error.'));
      process.stderr.write(`connector_error=${cause.code ?? 'internal_error'}\n`);
    }
  }
}

main().catch(cause => {
  process.stderr.write(`connector_start_failed=${cause.code ?? 'internal_error'}\n`);
  process.exitCode = 1;
});
