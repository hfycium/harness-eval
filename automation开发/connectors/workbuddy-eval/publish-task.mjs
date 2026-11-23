#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { link, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, '../../..');
const QUEUE_ROOT = process.env.HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT;
const AUTHORIZED_ROOT = process.env.HARNESS_EVAL_WORKBUDDY_ROOT;

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function fail(message) { throw new Error(message); }
function usage() { console.log('Usage: node publish-task.mjs --task <task.json>'); }
function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.includes(':') || /[\u0000-\u001f]/.test(value) || path.isAbsolute(value) || value.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) fail(`${label} must be a normalized relative path.`);
}
function rejectSensitiveKeys(value, location = 'task') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:oracle|answer|rubric|score|api[_-]?key|token|password|secret|credential)/i.test(key)) fail(`Forbidden field: ${location}.${key}`);
    rejectSensitiveKeys(child, `${location}.${key}`);
  }
}

export async function publishTask(task, { queueRoot: queueRootOption = QUEUE_ROOT, authorizedRoot = AUTHORIZED_ROOT } = {}) {
  if (!queueRootOption || !path.isAbsolute(queueRootOption) || !authorizedRoot || !path.isAbsolute(authorizedRoot)) fail('Set absolute HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT and HARNESS_EVAL_WORKBUDDY_ROOT paths.');
  const queueRoot = path.resolve(queueRootOption);
  const allowedRoot = await realpath(authorizedRoot);
  if (queueRoot === path.parse(queueRoot).root || inside(PROJECT_ROOT, queueRoot) || inside(PROJECT_ROOT, allowedRoot) || inside(queueRoot, PROJECT_ROOT) || inside(queueRoot, allowedRoot) || inside(allowedRoot, queueRoot)) fail('Queue and authorized workspace roots must be separate dedicated directories outside the repository and filesystem root.');
  rejectSensitiveKeys(task);
  if (typeof task.run_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(task.run_id)) fail('task.run_id is invalid.');
  if (typeof task.case_id !== 'string' || !task.case_id.trim()) fail('task.case_id is required.');
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) fail('task.prompt is required.');
  if (!Number.isInteger(task.timeout_seconds) || task.timeout_seconds < 1 || task.timeout_seconds > 86400) fail('task.timeout_seconds must be from 1 to 86400.');
  const workspace = await realpath(task.workspace_dir);
  if (!inside(allowedRoot, workspace) || workspace === allowedRoot) fail('task.workspace_dir must be inside the configured workspace root.');
  if (!Array.isArray(task.inputs) || !Array.isArray(task.expected_artifacts)) fail('task.inputs and task.expected_artifacts must be arrays.');

  for (const input of task.inputs) {
    safeRelative(input.path, 'input.path');
    if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) fail('input.sha256 must be a lowercase SHA-256 digest.');
    const inputPath = path.resolve(workspace, input.path);
    if (!inside(workspace, inputPath)) fail('Input path escapes its workspace.');
    const actualInputPath = await realpath(inputPath);
    if (!inside(workspace, actualInputPath)) fail('Input path resolves outside its workspace.');
    const actual = sha256(await readFile(actualInputPath));
    if (actual !== input.sha256) fail(`Input hash mismatch: ${input.path}`);
  }
  const artifacts = new Set();
  for (const value of task.expected_artifacts) {
    const item = typeof value === 'string' ? { path: value } : value;
    safeRelative(item?.path, 'expected_artifact.path');
    if (item.required !== undefined && typeof item.required !== 'boolean') fail(`expected_artifact.required must be boolean: ${item.path}`);
    if (artifacts.has(item.path)) fail(`Duplicate expected artifact: ${item.path}`);
    artifacts.add(item.path);
  }

  const promptHash = sha256(task.prompt);
  if (task.prompt_sha256 && task.prompt_sha256 !== promptHash) fail('prompt_sha256 does not match prompt.');
  const published = {
    run_id: task.run_id, case_id: task.case_id, prompt: task.prompt, prompt_sha256: promptHash,
    workspace_dir: workspace, inputs: task.inputs.map(({ path: relative, sha256: hash }) => ({ path: relative.replaceAll('\\', '/'), sha256: hash })),
    expected_artifacts: task.expected_artifacts.map(value => typeof value === 'string' ? value.replaceAll('\\', '/') : { path: value.path.replaceAll('\\', '/'), required: value.required !== false }),
    timeout_seconds: task.timeout_seconds, status: 'queued', queued_at: new Date().toISOString(),
  };
  published.task_sha256 = sha256(JSON.stringify(published));
  const pending = path.join(queueRoot, 'queue', 'pending');
  await mkdir(pending, { recursive: true });
  const queueReal = await realpath(queueRoot);
  const projectReal = await realpath(PROJECT_ROOT);
  if (inside(projectReal, queueReal) || inside(queueReal, projectReal) || inside(queueReal, workspace) || inside(workspace, queueReal)) fail('Resolved queue and workspace roots must be separate dedicated directories outside the project repository.');
  const target = path.join(pending, `${task.run_id}.json`);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(published, null, 2)}\n`, { flag: 'wx' });
  try {
    await link(temporary, target);
    await unlink(temporary);
  }
  catch (cause) {
    await unlink(temporary).catch(() => {});
    if (cause.code === 'EEXIST' || cause.code === 'EPERM') fail('A queue item with this run_id already exists; run IDs are never reused.');
    throw cause;
  }
  return { run_id: published.run_id, status: 'queued', task_sha256: published.task_sha256 };
}

async function main(argv) {
  const taskArg = argv.indexOf('--task');
  if (taskArg < 0 || !argv[taskArg + 1]) return usage();
  const task = JSON.parse(await readFile(path.resolve(argv[taskArg + 1]), 'utf8'));
  console.log(JSON.stringify(await publishTask(task)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
