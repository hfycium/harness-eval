#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-workbuddy-mcp-selfcheck-'));
const queueRoot = path.join(tempRoot, 'queue-data');
const workspaceRoot = path.join(tempRoot, 'authorized-workspaces');
const serverPath = path.join(here, 'server.mjs');
const publisherPath = path.join(here, 'publish-task.mjs');

function runChild(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

async function publishTask(task, env, fileName) {
  const taskPath = path.join(tempRoot, fileName);
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  const result = await runChild(process.execPath, [publisherPath, '--task', taskPath], env);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

async function main() {
  await mkdir(queueRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const env = {
    ...process.env,
    HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT: queueRoot,
    HARNESS_EVAL_WORKBUDDY_ROOT: workspaceRoot,
  };
  const runId = `selfcheck-${randomUUID()}`;
  const workspace = path.join(workspaceRoot, runId);
  await mkdir(workspace, { recursive: true });
  const input = Buffer.from('synthetic input for local MCP protocol self-check\n');
  await writeFile(path.join(workspace, 'input.txt'), input);
  const task = {
    run_id: runId, case_id: 'synthetic-case', prompt: 'Return the synthetic output file.',
    workspace_dir: workspace,
    inputs: [{ path: 'input.txt', sha256: digest(input) }],
    expected_artifacts: ['output.txt'], timeout_seconds: 60,
  };
  const published = await publishTask(task, env, 'task-submitted.json');
  assert.equal(published.status, 'queued');

  const worker = spawn(process.execPath, [serverPath], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: worker.stdout, crlfDelay: Infinity });
  const pending = new Map();
  let nextId = 1;
  let stderr = '';
  worker.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  rl.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}; ${stderr}`)); }, 5000);
    pending.set(id, { resolve: message => { clearTimeout(timer); resolve(message); } });
    worker.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  try {
    const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'local-selfcheck', version: '1' } });
    assert.equal(initialized.result?.protocolVersion, '2025-06-18');
    worker.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await rpc('tools/list');
    assert.deepEqual(listed.result?.tools?.map(item => item.name), ['claim_next_task', 'submit_result', 'report_blocked']);

    const claimed = await rpc('tools/call', { name: 'claim_next_task', arguments: {} });
    const claimedTask = JSON.parse(claimed.result.content[0].text);
    assert.equal(claimedTask.status, 'claimed');
    assert.equal(claimedTask.run_id, runId);
    assert.equal(claimedTask.inputs[0].sha256, digest(input));

    const pendingDuplicate = path.join(queueRoot, 'queue', 'pending', `${runId}.json`);
    const claimSnapshot = JSON.parse(await readFile(path.join(queueRoot, 'queue', 'claimed', `${runId}.json`), 'utf8'));
    const duplicate = { ...claimSnapshot, status: 'queued' };
    delete duplicate.claimed_at;
    delete duplicate.claim_token;
    await writeFile(pendingDuplicate, `${JSON.stringify(duplicate, null, 2)}\n`);
    const duplicateClaim = await rpc('tools/call', { name: 'claim_next_task', arguments: {} });
    assert.equal(JSON.parse(duplicateClaim.result.content[0].text).status, 'already_claimed');
    await unlink(pendingDuplicate);

    const output = Buffer.from('synthetic result file\n');
    await writeFile(path.join(workspace, 'output.txt'), output);
    const submitted = await rpc('tools/call', { name: 'submit_result', arguments: { run_id: runId, status: 'submitted', summary: 'self-check mock submission', artifact_paths: ['output.txt'] } });
    const submitBody = JSON.parse(submitted.result.content[0].text);
    assert.equal(submitBody.status, 'submitted');
    assert.equal(submitBody.artifacts[0].sha256, digest(output));
    assert.equal(submitBody.independent_task_verification, 'pending');

    const duplicateSubmit = await rpc('tools/call', { name: 'submit_result', arguments: { run_id: runId, status: 'submitted', artifact_paths: ['output.txt'] } });
    assert.equal(duplicateSubmit.result.isError, true);
    assert.equal(JSON.parse(duplicateSubmit.result.content[0].text).code, 'already_finalized');

    const blockedRunId = `selfcheck-${randomUUID()}`;
    const blockedWorkspace = path.join(workspaceRoot, blockedRunId);
    await mkdir(blockedWorkspace, { recursive: true });
    await publishTask({
      run_id: blockedRunId, case_id: 'synthetic-blocked-case', prompt: 'Synthetic blocked path.',
      workspace_dir: blockedWorkspace, inputs: [], expected_artifacts: [], timeout_seconds: 30,
    }, env, 'task-blocked.json');
    const nextClaim = await rpc('tools/call', { name: 'claim_next_task', arguments: {} });
    assert.equal(JSON.parse(nextClaim.result.content[0].text).run_id, blockedRunId);
    const blocked = await rpc('tools/call', { name: 'report_blocked', arguments: { run_id: blockedRunId, reason: 'synthetic permission block' } });
    assert.equal(JSON.parse(blocked.result.content[0].text).status, 'blocked');

    const runEvents = (await readFile(path.join(queueRoot, 'queue', 'events', `${runId}.jsonl`), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(runEvents.some(event => event.event === 'claim' && event.source === 'mcp_connector_server'));
    assert.ok(runEvents.some(event => event.event === 'submit_result' && event.artifacts[0].sha256 === digest(output)));
    const storedResult = JSON.parse(await readFile(path.join(queueRoot, 'queue', 'results', `${runId}.json`), 'utf8'));
    assert.equal(storedResult.agent_claimed.status, 'submitted');
    assert.equal(storedResult.independent_task_verification, 'pending');
    const globalEvents = (await readFile(path.join(queueRoot, 'queue', 'events', 'connector.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(globalEvents.some(event => event.event === 'tool_request' && event.method === 'claim_next_task'));
    assert.ok(globalEvents.some(event => event.event === 'tool_response' && event.response_sha256));

    console.log(JSON.stringify({
      status: 'passed',
      scope: 'local synthetic MCP/queue self-check; no WorkBuddy process or model call',
      checks: ['task_publish_and_input_hash', 'MCP_initialize_and_tool_list', 'claim', 'duplicate_claim_blocked', 'artifact_path_and_hash', 'duplicate_submit_blocked', 'blocked_state', 'boundary_jsonl', 'agent_claim_separated_from_independent_verification'],
      run_ids: [runId, blockedRunId],
      temp_evidence: 'deleted after successful check',
    }, null, 2));
  } finally {
    worker.stdin.end();
    await new Promise(resolve => {
      const timeout = setTimeout(() => { worker.kill(); resolve(); }, 2000);
      worker.once('close', () => { clearTimeout(timeout); resolve(); });
    });
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(async error => {
  console.error(error.stack ?? error.message);
  await rm(tempRoot, { recursive: true, force: true });
  process.exitCode = 1;
});
