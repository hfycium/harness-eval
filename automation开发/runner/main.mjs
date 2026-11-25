#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HarnessAdapter } from '../adapters/base.mjs';
import { getAdapter } from '../adapters/registry.mjs';
import { resolveWorkBuddyWorkspaceRoot } from '../adapters/workbuddy.mjs';
import { captureCodexPromptEvidence } from './codex-prompt-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKBUDDY_WORKSPACE_ROOT_ENV = 'HARNESS_EVAL_WORKBUDDY_ROOT';

function isConnectorQueueMode(productId, config) {
  return (productId === 'workbuddy' && config?.entry_id === 'workbuddy-connector-queue')
    || (productId === 'doubao-work' && config?.entry_id === 'doubao-work-connector-queue');
}

function usage() {
  console.log('Usage:\n  node automation开发/run-eval.mjs credential deepseek set|status|remove\n  node automation开发/run-eval.mjs prepare --case <case.json> --harness <product_id> [--config <config.json>]\n  node automation开发/run-eval.mjs run --case <case.json> --harness <product_id> [--config <config.json>] [--score-spreadsheetbench-answer <answer.xlsx> --score-spreadsheetbench-evaluator <evaluation.py> --score-spreadsheetbench-revision <commit> --score-spreadsheetbench-output <new-dir>]\n  node automation开发/run-eval.mjs verify --run-dir <archived-run> --output-dir <new-dir> [--artifact <path>] [--answer <answer.xlsx> --recalculated-output <file.xlsx> --recalculated-from-sha256 <sha256> --recalculation-method <description> --evaluator <evaluation.py> --evaluator-revision <commit>]');
}

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}

function insideRoot(relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return resolved;
}

function isWithinPath(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function assertRealPathInsideRoot(filePath, label) {
  const rootRealPath = await realpath(root);
  const fileRealPath = await realpath(filePath);
  if (fileRealPath !== rootRealPath && !fileRealPath.startsWith(rootRealPath + path.sep)) {
    throw new Error(`${label} resolves outside the project root.`);
  }
  return fileRealPath;
}

async function ensureProjectDirectory(relativePath) {
  const absolutePath = insideRoot(relativePath);
  let current = root;
  for (const segment of path.relative(root, absolutePath).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    await assertRealPathInsideRoot(current, 'Project output directory');
  }
  return absolutePath;
}

async function digest(file) {
  const bytes = await readFile(file);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length };
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function rejectCredentialFields(value, location = 'config') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const isSafeApiKeyEnvironmentName = /^api_key_env$/i.test(key)
      && typeof child === 'string'
      && /^[A-Za-z_][A-Za-z0-9_]*$/.test(child);
    if (/(api[_-]?key|token|password|secret|credential)/i.test(key) && !isSafeApiKeyEnvironmentName) {
      throw new Error(`Credential-like config field is forbidden: ${location}.${key}. Supply credentials through the launching process environment.`);
    }
    rejectCredentialFields(child, `${location}.${key}`);
  }
}

function now() { return new Date().toISOString(); }

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve({ status: 'unconfirmed', method: 'none', reason: 'missing_pid' });
  const executable = process.platform === 'win32' ? 'taskkill.exe' : null;
  if (!executable) {
    try {
      const sent = process.kill(pid, 'SIGTERM');
      return Promise.resolve({ status: sent ? 'signal_sent' : 'unconfirmed', process_tree_state: 'unknown', method: 'process.kill', signal: 'SIGTERM' });
    } catch (error) {
      return Promise.resolve({ status: 'unconfirmed', process_tree_state: 'unknown', method: 'process.kill', reason: error.code ?? 'termination_error' });
    }
  }
  return new Promise(resolve => {
    const killer = spawn(executable, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    let settled = false;
    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killer.kill();
      settle({ status: 'unconfirmed', process_tree_state: 'unknown', method: 'taskkill_tree_force', reason: 'termination_timeout' });
    }, 10000);
    killer.once('error', error => settle({ status: 'unconfirmed', process_tree_state: 'unknown', method: 'taskkill_tree_force', reason: error.code ?? 'termination_error' }));
    killer.once('close', code => settle({ status: code === 0 ? 'command_succeeded' : 'command_failed', process_tree_state: 'unknown', method: 'taskkill_tree_force', exit_code: code }));
  });
}

const sessionStatuses = new Set(['completed', 'failed', 'timed_out', 'interrupted', 'requires_action']);
const submissionStatuses = new Set(['submitted', 'unconfirmed', 'failed']);

function usesSessionExecution(adapter) {
  return adapter.runSession !== HarnessAdapter.prototype.runSession;
}

function validateSessionResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Session adapter must return an object.');
  const allowed = new Set(['submission_status', 'submission_evidence', 'execution_status', 'completion_evidence', 'observations', 'missing', 'evidence_refs', 'error']);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) throw new Error(`Session result contains unsupported field '${key}'.`);
  }
  if (!submissionStatuses.has(result.submission_status)) throw new Error('Session result has an invalid submission_status.');
  if (!sessionStatuses.has(result.execution_status)) throw new Error('Session result has an invalid execution_status.');
  if (!result.completion_evidence || typeof result.completion_evidence !== 'object' || Array.isArray(result.completion_evidence)) throw new Error('Session result requires completion_evidence.');
  const evidenceKeys = new Set(['task_success_verified', 'remote_status']);
  for (const key of Object.keys(result.completion_evidence)) {
    if (!evidenceKeys.has(key)) throw new Error(`Session completion_evidence contains unsupported field '${key}'.`);
  }
  if (typeof result.completion_evidence.task_success_verified !== 'boolean') throw new Error('completion_evidence.task_success_verified must be boolean.');
  if (result.completion_evidence.remote_status !== undefined && (typeof result.completion_evidence.remote_status !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(result.completion_evidence.remote_status))) throw new Error('completion_evidence.remote_status must be a safe status identifier.');
  if (!Array.isArray(result.observations) || !Array.isArray(result.missing)) throw new Error('Session result requires observations and missing arrays.');
  for (const observation of result.observations) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new Error('Session observations must be objects.');
    const keys = new Set(['source', 'event', 'status', 'timestamp']);
    for (const key of Object.keys(observation)) if (!keys.has(key)) throw new Error(`Session observation contains unsupported field '${key}'.`);
    for (const key of ['source', 'event', 'status']) if (typeof observation[key] !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(observation[key])) throw new Error(`Session observation.${key} must be a safe identifier.`);
    if (observation.timestamp !== undefined && (typeof observation.timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(observation.timestamp))) throw new Error('Session observation.timestamp must be an ISO-like timestamp.');
  }
  const submission = result.submission_evidence;
  if (!submission || typeof submission !== 'object' || Array.isArray(submission) || Object.keys(submission).some(key => !['prompt_submitted', 'prompt_ref', 'inputs'].includes(key)) || typeof submission.prompt_submitted !== 'boolean' || !Array.isArray(submission.inputs)) throw new Error('Session result requires explicit submission_evidence.');
  if (submission.prompt_ref !== undefined && (typeof submission.prompt_ref !== 'string' || !/^[A-Za-z0-9_.\\/-]{1,240}$/.test(submission.prompt_ref) || submission.prompt_ref.split(/[\\/]/).some(segment => segment === '.' || segment === '..'))) throw new Error('Session prompt_ref must be a safe path relative to the run directory.');
  for (const input of submission.inputs) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['path', 'sha256'].includes(key)) || typeof input.path !== 'string' || !/^[A-Za-z0-9_.\\/-]{1,240}$/.test(input.path) || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Session input evidence must contain a safe relative path and SHA-256.');
  }
  if (result.evidence_refs !== undefined && (!Array.isArray(result.evidence_refs) || result.evidence_refs.some(ref => typeof ref !== 'string' || !/^[A-Za-z0-9_.\/-]{1,240}$/.test(ref) || ref.split('/').some(segment => segment === '.' || segment === '..')))) throw new Error('Session evidence_refs must be safe paths relative to the run directory.');
  if (result.submission_status === 'submitted' && !submission.prompt_submitted) throw new Error('A submitted session must confirm prompt_submitted.');
  for (const item of result.missing) if (typeof item !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(item)) throw new Error('Session missing entries must be safe identifiers.');
  if (result.error === undefined) throw new Error('Session result must set error to null or a safe error object.');
  if (result.error !== null && (!result.error || typeof result.error !== 'object' || !['code', 'phase'].every(key => typeof result.error[key] === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(result.error[key])) || Object.keys(result.error).some(key => !['code', 'phase'].includes(key)))) {
    throw new Error('Session error must contain only short code and phase strings; do not include raw response text or credentials.');
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === 'verify') {
    const runArg = option(args, '--run-dir');
    const outputArg = option(args, '--output-dir');
    if (!runArg || !outputArg) throw new Error('verify requires --run-dir and --output-dir.');
    const runDir = insideRoot(runArg);
    const outputDir = insideRoot(outputArg);
    await assertRealPathInsideRoot(runDir, 'Archived run');
    await assertRealPathInsideRoot(path.dirname(outputDir), 'Verification output parent');
    try { await lstat(outputDir); throw new Error('Verification output directory already exists; choose a new path.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const verifier = insideRoot(path.join('automation开发', 'scorers', 'verify-run.py'));
    const python = option(args, '--verify-python', 'python');
    const passthrough = ['--artifact', '--text-expected-file', '--answer', '--recalculated-output', '--recalculated-from-sha256', '--recalculation-method', '--evaluator', '--evaluator-revision', '--timeout'];
    const verifyArgs = [verifier, '--run-dir', runDir, '--output-dir', outputDir];
    for (const name of passthrough) {
      const value = option(args, name);
      if (value !== null) {
        const isFilePath = ['--text-expected-file', '--answer', '--recalculated-output', '--evaluator'].includes(name);
        const resolved = isFilePath ? insideRoot(value) : value;
        if (isFilePath) await assertRealPathInsideRoot(resolved, `Verification input ${name}`);
        verifyArgs.push(name, resolved);
      }
    }
    const check = await new Promise(resolve => {
      const child = spawn(python, verifyArgs, { cwd: root, windowsHide: true, shell: false, stdio: 'inherit' });
      child.once('error', error => resolve({ status: 'failed_to_start', error_code: error.code ?? 'spawn_error' }));
      child.once('close', code => resolve({ status: code === 0 ? 'finished' : 'failed', exit_code: code }));
    });
    if (check.status !== 'finished') throw new Error(`Verification ${check.status}${check.error_code ? `: ${check.error_code}` : ` (exit ${check.exit_code})`}.`);
    return;
  }
  if (!['prepare', 'run'].includes(command)) return usage();
  const verifyExpectedArg = option(args, '--verify-text-expected');
  const verifyArtifactArg = option(args, '--verify-text-artifact');
  const verifyOutputArg = option(args, '--verification-output');
  const verifyTimeoutSeconds = Number(option(args, '--verify-timeout', 120));
  const wantsVerification = Boolean(verifyExpectedArg || verifyArtifactArg || verifyOutputArg);
  const scoreAnswerArg = option(args, '--score-spreadsheetbench-answer');
  const scoreEvaluatorArg = option(args, '--score-spreadsheetbench-evaluator');
  const scoreRevisionArg = option(args, '--score-spreadsheetbench-revision');
  const scoreOutputArg = option(args, '--score-spreadsheetbench-output');
  const wantsSpreadsheetScoring = Boolean(scoreAnswerArg || scoreEvaluatorArg || scoreRevisionArg || scoreOutputArg);
  if (wantsSpreadsheetScoring && (command !== 'run' || !scoreAnswerArg || !scoreEvaluatorArg || !scoreRevisionArg || !scoreOutputArg)) throw new Error('SpreadsheetBench auto-scoring requires run and --score-spreadsheetbench-answer, --score-spreadsheetbench-evaluator, --score-spreadsheetbench-revision and --score-spreadsheetbench-output.');
  if (wantsVerification && wantsSpreadsheetScoring) throw new Error('Choose either text verification or SpreadsheetBench scoring for one run.');
  if (wantsVerification && (command !== 'run' || !verifyExpectedArg || !verifyArtifactArg || !verifyOutputArg)) {
    throw new Error('Text verification requires run, --verify-text-expected, --verify-text-artifact and --verification-output.');
  }
  if ((wantsVerification || wantsSpreadsheetScoring) && (!Number.isInteger(verifyTimeoutSeconds) || verifyTimeoutSeconds < 1 || verifyTimeoutSeconds > 3600)) throw new Error('--verify-timeout must be an integer from 1 to 3600 seconds.');
  const casePath = insideRoot(option(args, '--case'));
  const configuredProduct = option(args, '--harness');
  const configArg = option(args, '--config') ?? option(args, '--adapter');
  if (!configuredProduct && !configArg) throw new Error('Select a Harness with --harness <id> or provide --config.');
  let defaultConfigPath = configuredProduct ? path.join('automation开发', 'configs', `${configuredProduct}.example.json`) : null;
  if (!configArg && configuredProduct) {
    const localConfigPath = path.join('automation开发', 'configs', `${configuredProduct}.local.json`);
    try {
      if ((await stat(insideRoot(localConfigPath))).isFile()) defaultConfigPath = localConfigPath;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const adapterPath = insideRoot(configArg ?? defaultConfigPath);
  await assertRealPathInsideRoot(casePath, 'Case file');
  await assertRealPathInsideRoot(adapterPath, 'Adapter config');
  const task = await loadJson(casePath);
  let spreadsheetScoringArtifact = null;
  if (wantsSpreadsheetScoring) {
    const declared = (task.expected_artifacts ?? []).filter(item => typeof item === 'string' || item?.required !== false).map(item => typeof item === 'string' ? item : item.path);
    spreadsheetScoringArtifact = option(args, '--score-spreadsheetbench-artifact') ?? (declared.length === 1 ? declared[0] : null);
    if (!spreadsheetScoringArtifact || !declared.includes(spreadsheetScoringArtifact)) throw new Error('SpreadsheetBench scoring requires --score-spreadsheetbench-artifact when the case does not declare exactly one required artifact.');
    const scoreOutput = insideRoot(scoreOutputArg);
    await assertRealPathInsideRoot(path.dirname(scoreOutput), 'Scoring output parent');
    try { await lstat(scoreOutput); throw new Error('Scoring output directory already exists; choose a new path.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const adapterConfig = await loadJson(adapterPath);
  rejectCredentialFields(adapterConfig);
  const productId = configuredProduct ?? adapterConfig.product_id;
  if (!productId) throw new Error('Harness ID is missing; use --harness or define product_id in the config.');
  if (adapterConfig.product_id && adapterConfig.product_id !== productId) throw new Error(`Config product_id '${adapterConfig.product_id}' does not match selected Harness '${productId}'.`);
  const adapter = getAdapter(productId);
  const adapterConfigHash = await digest(adapterPath);
  const adapterModulePath = insideRoot(path.join('automation开发', 'adapters', `${productId}.mjs`));
  const adapterImplementationPaths = [adapterModulePath];
  if (command === 'run' && ['dsh', 'codex'].includes(productId)) {
    adapterImplementationPaths.push(
      insideRoot(path.join('automation开发', 'runner', 'deepseek-credential.mjs')),
    );
  }
  if (productId === 'workbuddy' && adapterConfig.entry_id === 'workbuddy-local-scheduler-uia') {
    adapterImplementationPaths.push(
      insideRoot(path.join('automation开发', 'adapters', 'workbuddy-scheduler-uia.mjs')),
      insideRoot(path.join('automation开发', 'tools', 'workbuddy-scheduler-uia.ps1')),
    );
  }
  if (isConnectorQueueMode(productId, adapterConfig)) {
    adapterImplementationPaths.push(insideRoot(path.join('automation开发', 'adapters', 'workbuddy-connector-queue.mjs')), insideRoot(path.join('automation开发', 'connectors', 'workbuddy-eval', 'publish-task.mjs')), insideRoot(path.join('automation开发', 'connectors', 'workbuddy-eval', 'server.mjs')), insideRoot(path.join('automation开发', 'connectors', 'workbuddy-eval', 'queue-lifecycle.mjs')));
    if (command === 'run' && productId === 'workbuddy') adapterImplementationPaths.push(insideRoot(path.join('automation开发', 'adapters', 'workbuddy', 'skills', 'workbuddy-eval-execution', 'SKILL.md')));
  }
  const adapterImplementationFiles = await Promise.all(adapterImplementationPaths.map(async implementationPath => ({
    ref: path.relative(root, implementationPath).replaceAll('\\', '/'),
    ...(await digest(implementationPath)),
  })));
  const adapterModuleHash = adapterImplementationFiles[0];
  const runnerModulePath = fileURLToPath(import.meta.url);
  const runnerModuleHash = await digest(runnerModulePath);
  const promptSource = insideRoot(task.prompt_source);
  const inputSource = insideRoot(task.input_source);
  await assertRealPathInsideRoot(promptSource, 'Prompt source');
  await assertRealPathInsideRoot(inputSource, 'Input source');
  if (wantsVerification) await assertRealPathInsideRoot(insideRoot(verifyExpectedArg), 'Evaluator-side text expectation');
  if (wantsSpreadsheetScoring) {
    for (const [label, value] of [['SpreadsheetBench answer', scoreAnswerArg], ['SpreadsheetBench evaluator', scoreEvaluatorArg]]) await assertRealPathInsideRoot(insideRoot(value), label);
  }
  const promptStat = await stat(promptSource);
  const promptSourceHash = await digest(promptSource);
  let effectivePrompt = await readFile(promptSource, 'utf8');
  if (command === 'run' && productId === 'workbuddy' && adapterConfig.entry_id === 'workbuddy-connector-queue') {
    const executionSkillPath = insideRoot(path.join('automation开发', 'adapters', 'workbuddy', 'skills', 'workbuddy-eval-execution', 'SKILL.md'));
    await assertRealPathInsideRoot(executionSkillPath, 'WorkBuddy task execution Skill');
    const skillSource = await readFile(executionSkillPath, 'utf8');
    const skillBody = skillSource.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    if (!skillBody) throw new Error('WorkBuddy task execution Skill is empty.');
    effectivePrompt = `# WorkBuddy HarnessEval execution contract\n\n${skillBody}\n\n---\n\n# Case task prompt\n\n${effectivePrompt.trim()}\n`;
  }
  const inputHash = await digest(inputSource);
  if (!promptStat.isFile()) throw new Error('Prompt source must be a file.');
  if (adapter.productId !== productId || !adapterConfig.entry_id) throw new Error('Selected adapter and config must define matching product_id and entry_id.');

  const requestedRunId = option(args, '--run-id');
  if (requestedRunId !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(requestedRunId)) throw new Error('Invalid --run-id; use at most 160 ASCII letters, digits, underscores or hyphens.');
  const runId = requestedRunId ?? `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${task.case_id}-${productId}-${randomUUID().slice(0, 8)}`;
  const runArchiveRoot = await ensureProjectDirectory(path.join('runs', '自动化'));
  const runDir = path.join(runArchiveRoot, runId);
  const useTempWorkspace = args.includes('--temp-workspace') || adapterConfig.temp_workspace === true;
  const connectorQueueMode = isConnectorQueueMode(productId, adapterConfig);
  const workspaceRootEnvName = connectorQueueMode || productId === 'workbuddy' ? adapterConfig.workspace_root_env : null;
  if (workspaceRootEnvName && workspaceRootEnvName !== WORKBUDDY_WORKSPACE_ROOT_ENV) throw new Error('Connector workspace_root_env must be ' + WORKBUDDY_WORKSPACE_ROOT_ENV + '.');
  const configuredWorkspaceRoot = connectorQueueMode
    ? process.env[workspaceRootEnvName]
    : productId === 'workbuddy' ? resolveWorkBuddyWorkspaceRoot() : null;
  let workspaceRef = `system-temp/HarnessEval/${runId}`;
  let productWorkspace;
  if (configuredWorkspaceRoot) {
    if (!path.isAbsolute(configuredWorkspaceRoot)) throw new Error(`${WORKBUDDY_WORKSPACE_ROOT_ENV} must be an absolute path.`);
    const workspaceRoot = path.resolve(configuredWorkspaceRoot);
    if (path.parse(workspaceRoot).root === workspaceRoot || isWithinPath(root, workspaceRoot) || isWithinPath(workspaceRoot, root)) throw new Error('WorkBuddy workspace root must be a dedicated directory outside the project repository and filesystem root.');
    productWorkspace = path.join(workspaceRoot, runId);
    workspaceRef = (productId === 'workbuddy' ? 'workbuddy' : 'doubao-work') + '-authorized-root/' + runId;
  } else {
    if (!useTempWorkspace) throw new Error('Product workspace isolation is required. Set temp_workspace=true or configure a dedicated workspace root.');
    productWorkspace = path.join(os.tmpdir(), 'HarnessEval', runId);
  }
  const inputRel = task.input_destination ?? path.join('inputs', path.basename(inputSource));
  const runInput = path.resolve(productWorkspace, inputRel);
  if (wantsVerification && isWithinPath(productWorkspace, insideRoot(verifyExpectedArg))) throw new Error('Expected answer must not be inside the product workspace.');
  if (!runInput.startsWith(productWorkspace + path.sep)) throw new Error('Input destination escapes product workspace.');
  const promptRel = 'prompt.md';
  const outputDir = path.join(productWorkspace, 'outputs');
  await mkdir(runDir);
  await assertRealPathInsideRoot(runDir, 'Run archive directory');
  await mkdir(productWorkspace, { recursive: true });
  const canonicalProductWorkspace = await realpath(productWorkspace);
  if (isWithinPath(await realpath(root), canonicalProductWorkspace)) throw new Error('Product workspace resolves inside the project repository.');
  await mkdir(path.dirname(runInput), { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(runDir, promptRel), effectivePrompt, 'utf8');
  await copyFile(casePath, path.join(runDir, 'case.json'));
  await writeFile(path.join(productWorkspace, promptRel), effectivePrompt, 'utf8');
  await copyFile(inputSource, runInput);
  const evidenceInput = path.join(runDir, inputRel);
  await mkdir(path.dirname(evidenceInput), { recursive: true });
  await copyFile(inputSource, evidenceInput);
  const promptHash = await digest(path.join(runDir, promptRel));
  const caseHash = await digest(path.join(runDir, 'case.json'));
  const apiKeyEnvName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(adapterConfig.api_key_env ?? '')
    ? adapterConfig.api_key_env
    : 'DEEPSEEK_API_KEY';
  const safeCredentialEnvironment = {
    DSH_HOME: Boolean(process.env.DSH_HOME),
    [apiKeyEnvName]: Boolean(process.env[apiKeyEnvName]),
    DEEPSEEK_API_KEY_SOURCE: process.env.HARNESS_EVAL_DEEPSEEK_CREDENTIAL_SOURCE ?? (process.env[apiKeyEnvName] ? 'process_environment' : 'none'),
    WORKBUDDY_ACCESS_TOKEN: Boolean(process.env.WORKBUDDY_ACCESS_TOKEN),
    [WORKBUDDY_WORKSPACE_ROOT_ENV]: Boolean(process.env[WORKBUDDY_WORKSPACE_ROOT_ENV]),
  };
  const configSnapshot = {
    product_id: productId,
    entry_id: adapterConfig.entry_id ?? null,
    ...adapter.snapshotConfig(adapterConfig, { environment: safeCredentialEnvironment }),
  };
  let modelPatchEvidence = null;
  if (productId === 'dsh' && adapterConfig.model_patch) {
    const patchSource = insideRoot(adapterConfig.model_patch);
    await assertRealPathInsideRoot(patchSource, 'DSH model condition patch');
    const patchSourceHash = await digest(patchSource);
    const patchEvidencePath = path.join(runDir, 'model-condition', path.basename(patchSource));
    await mkdir(path.dirname(patchEvidencePath), { recursive: true });
    await copyFile(patchSource, patchEvidencePath);
    const patchArchiveHash = await digest(patchEvidencePath);
    if (patchSourceHash.sha256 !== patchArchiveHash.sha256) throw new Error('DSH model condition patch changed while being archived.');
    configSnapshot.model_patch_sha256 = patchArchiveHash.sha256;
    modelPatchEvidence = {
      kind: 'model_condition_config',
      path: path.relative(runDir, patchEvidencePath).replaceAll('\\', '/'),
      sha256: patchArchiveHash.sha256,
      source: 'adapter_config',
    };
  }
  const configSnapshotPath = path.join(runDir, 'adapter-config.snapshot.json');
  await writeFile(configSnapshotPath, JSON.stringify(configSnapshot, null, 2) + '\n', 'utf8');
  const configSnapshotHash = await digest(configSnapshotPath);
  const permissionDescription = adapter.permissionDescription(adapterConfig);
  const modelCondition = typeof adapter.modelCondition === 'function'
    ? adapter.modelCondition(adapterConfig, {
        environment: {
        ...safeCredentialEnvironment,
      },
      })
    : null;
  if (modelCondition && modelPatchEvidence) modelCondition.evidence_refs = [modelPatchEvidence.path];

  const run = {
    record_version: '0.2', run_id: runId, previous_run_id: null,
    product: { product_id: productId, entry_id: adapterConfig.entry_id ?? null, product_version: null, version_evidence: null, model: null, model_evidence: null, mode: null },
    adapter: {
      adapter_id: productId, revision: adapter.revision, launcher_version: '0.2.0',
      launcher_implementation_ref: path.relative(runDir, runnerModulePath).replaceAll('\\', '/'),
      launcher_implementation_sha256: runnerModuleHash.sha256,
      implementation_ref: path.relative(runDir, adapterModulePath).replaceAll('\\', '/'),
      implementation_sha256: adapterModuleHash.sha256,
      implementation_files: adapterImplementationFiles,
      config_ref: 'adapter-config.snapshot.json', config_sha256: configSnapshotHash.sha256,
      source_config_ref: path.relative(runDir, adapterPath).replaceAll('\\', '/'),
      source_config_sha256: adapterConfigHash.sha256,
      automation_mode: adapterConfig.automation_mode ?? 'unknown'
    },
    task: {
      task_id: task.dataset_task_id, task_version: task.case_version, contract_version: '0.2', case_id: task.case_id,
      package_ref: 'case.json', case_sha256: caseHash.sha256, prompt_sha256: promptHash.sha256, prompt_source_sha256: promptSourceHash.sha256,
      inputs: [{ path: inputRel.replaceAll('\\', '/'), size_bytes: inputHash.size_bytes, sha256: inputHash.sha256 }]
    },
    environment: { os: process.platform, workspace_ref: workspaceRef, permissions: permissionDescription, limits: task.limits ?? null },
    model_condition: modelCondition,
    timing: { started_at: null, ended_at: null },
    submission: { status: 'unconfirmed', actual_prompt_ref: promptRel, actual_inputs: [], transformations: [], evidence_refs: [] },
    execution: { status: 'not_started', completion_evidence: null, error: null },
    operator_actions: [], retry_events: [], artifacts: [], evidence: modelPatchEvidence ? [modelPatchEvidence] : [], observations: [],
    missing: [
      { field: 'product.product_version', reason: 'unknown', detail: 'Not yet captured by this adapter.' },
      { field: 'product.model', reason: 'not_visible', detail: 'Model identity is not assumed from the product name.' },
      { field: permissionDescription ? 'environment.permissions.enforcement' : 'environment.permissions', reason: 'unknown', detail: permissionDescription ? 'Requested permission mode is recorded, but runtime enforcement is not verified.' : 'Permission boundary must be recorded before a real run.' }
    ],
    verification: { status: 'not_performed', method: null, evidence_refs: [] }, notes: null
  };
  const recordPath = path.join(runDir, 'run.json');
  const eventPath = path.join(runDir, 'events.jsonl');
  const tracePath = path.join(runDir, 'trace.json');
  const event = async (phase, eventName, result, details = {}) => {
    const entries = await readFile(eventPath, 'utf8').catch(() => '');
    const sequence = entries ? entries.trimEnd().split('\n').length + 1 : 1;
    await writeFile(eventPath, JSON.stringify({ sequence, timestamp: now(), phase, actor: 'launcher', event: eventName, result, details }) + '\n', { flag: 'a' });
  };
  const save = () => writeFile(recordPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
  const recordEventEvidence = async () => {
    const eventHash = await digest(eventPath);
    run.evidence = run.evidence.filter(item => item.path !== 'events.jsonl');
    run.evidence.push({ kind: 'events', path: 'events.jsonl', sha256: eventHash.sha256, source: 'launcher' });
  };
  const saveTrace = () => writeFile(tracePath, JSON.stringify({
    trace_version: '0.2', run_id: run.run_id,
    product: run.product, adapter: run.adapter, task: run.task,
    model_condition: run.model_condition,
    execution: run.execution, observations: run.observations,
    artifacts: run.artifacts, evidence: run.evidence, missing: run.missing,
    verification: run.verification,
    scoring_gate: {
      artifact_status: (task.expected_artifacts ?? []).filter(item => typeof item === 'string' || item.required !== false).length === 0
        ? 'not_applicable'
        : (task.expected_artifacts ?? []).filter(item => typeof item === 'string' || item.required !== false)
          .every(item => run.artifacts.some(artifact => artifact.path === (typeof item === 'string' ? item : item.path) && artifact.collection_status === 'collected'))
          ? 'ready' : 'blocked',
      benchmark_status: task.oracle?.status === 'integrated' ? 'oracle_configured' : 'blocked',
      benchmark_reason: task.oracle?.status === 'integrated' ? null : 'Case oracle is not integrated; no benchmark score may be reported.'
    }
  }, null, 2) + '\n', 'utf8');
  await event('prepare', 'run_created', 'ok', { run_id: runId });

  if (command === 'prepare') {
    run.execution.status = 'not_started';
    await event('prepare', 'prepare_only', 'ok');
    await recordEventEvidence();
    await save();
    await saveTrace();
    console.log(runDir);
    return;
  }

  const profile = option(args, '--profile', adapterConfig.profile);
  const timeoutSeconds = Number(option(args, '--timeout', adapterConfig.timeout_seconds));
  // An explicit process-level DSH_HOME lets an operator reuse an authenticated
  // local DSH installation without copying credentials into the project.
  const dshHome = process.env.DSH_HOME || (adapterConfig.home ? insideRoot(adapterConfig.home) : null);
  run.adapter.profile = profile ?? null;
  run.environment.limits = { ...(task.limits ?? {}), timeout_seconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : null };
  const preflight = adapter.preflight(adapterConfig, {
    profile, timeoutSeconds,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    task,
    environment: safeCredentialEnvironment,
  });
  if (preflight.status !== 'ready') {
    run.execution.status = 'not_admitted';
    run.execution.error = { code: 'adapter_not_admitted', message: preflight.reason, phase: 'preflight' };
    for (const item of preflight.missing ?? []) {
      const field = typeof item === 'string' ? item : item.field;
      const reason = typeof item === 'string' ? 'unknown' : item.reason ?? 'unknown';
      const detail = typeof item === 'string' ? preflight.reason : item.detail ?? preflight.reason;
      run.missing.push({ field: `adapter.${field}`, reason, detail });
    }
    await event('preflight', 'execution_blocked', 'not_admitted', run.execution.error);
    await recordEventEvidence();
    await save();
    await saveTrace();
    console.error(`Not admitted. Prepared run: ${runDir}`);
    process.exitCode = 2;
    return;
  }

  const prompt = await readFile(path.join(runDir, promptRel), 'utf8');
  run.timing.started_at = now();
  run.execution.status = 'running';
  run.submission.status = 'unconfirmed';
  let result;
  let timedOut = false;
  let sessionTimedOut = false;
  if (usesSessionExecution(adapter)) {
    await event('submit', 'session_starting', 'ok', { profile });
    const controller = new AbortController();
    let timer;
    try {
      const execution = Promise.resolve().then(() => adapter.runSession({
        config: adapterConfig, prompt, profile, runId, caseId: task.case_id, timeoutSeconds, runDir, workspaceDir: productWorkspace,
        inputPath: runInput, inputRelativePath: inputRel, inputSha256: inputHash.sha256,
        expectedArtifacts: task.expected_artifacts ?? [], outputDir, signal: controller.signal,
      })).then(validateSessionResult);
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => {
          timedOut = true;
          sessionTimedOut = true;
          controller.abort();
          if (connectorQueueMode) {
            Promise.race([execution.catch(() => null), new Promise(done => setTimeout(() => done(null), 5000))]).then(() => resolve(null));
          } else resolve(null);
        }, timeoutSeconds * 1000);
      });
      const outcome = await Promise.race([execution, timeout]);
      result = outcome ?? {
        submission_status: 'unconfirmed', submission_evidence: { prompt_submitted: false, inputs: [] },
        execution_status: 'timed_out', completion_evidence: { task_success_verified: false },
        observations: [], missing: [], error: { code: 'session_timeout', phase: 'execute' },
      };
    } catch (error) {
      result = {
        submission_status: 'unconfirmed', submission_evidence: { prompt_submitted: false, inputs: [] },
        execution_status: timedOut ? 'timed_out' : connectorQueueMode ? 'requires_action' : 'failed',
        completion_evidence: { task_success_verified: false },
        observations: [], missing: [],
        error: { code: timedOut ? 'session_timeout' : 'session_adapter_error', phase: 'execute' },
      };
    } finally { clearTimeout(timer); }
    if (connectorQueueMode && !result.evidence_refs) {
      const ref = productId === 'workbuddy' ? 'workbuddy-queue/queue-events.jsonl' : 'doubao-work-queue/queue-events.jsonl';
      try {
        if ((await stat(path.join(runDir, ref))).isFile()) result.evidence_refs = [ref];
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      result.missing.push('queue_state_requires_manual_reconciliation');
    }
    const expectedInput = { path: inputRel.replaceAll('\\', '/'), sha256: inputHash.sha256 };
    const submittedInputs = result.submission_evidence.inputs;
    const inputEvidenceMatches = submittedInputs.length === 0 || (submittedInputs.length === 1 && submittedInputs[0].path === expectedInput.path && submittedInputs[0].sha256 === expectedInput.sha256);
    if (result.submission_status === 'submitted' && (!result.submission_evidence.prompt_submitted || !inputEvidenceMatches)) {
      result = {
        submission_status: 'unconfirmed', submission_evidence: { prompt_submitted: false, inputs: [] },
        execution_status: result.execution_status, completion_evidence: result.completion_evidence,
        observations: result.observations, missing: [...result.missing, 'submission_evidence_mismatch'],
        error: result.error,
      };
    }
    run.submission.status = result.submission_status;
    if (result.submission_status === 'submitted') {
      run.submission.actual_prompt_ref = result.submission_evidence.prompt_ref ?? promptRel;
      run.submission.actual_inputs = submittedInputs;
    } else {
      run.submission.actual_inputs = [];
    }
    run.execution.status = result.execution_status;
    run.execution.completion_evidence = result.completion_evidence;
    run.execution.error = result.error;
    run.observations = result.observations;
    run.operator_actions = result.observations
      .filter(observation => observation.source === 'operator_report')
      .map(observation => ({
        timestamp: observation.timestamp ?? now(),
        phase: observation.event,
        action: observation.event,
        result: observation.status,
        evidence_refs: [],
        source: 'operator_report',
      }));
    const sessionEvidenceRoot = await realpath(runDir);
    for (const ref of result.evidence_refs ?? []) {
      const evidenceFile = path.resolve(runDir, ref);
      if (!evidenceFile.startsWith(runDir + path.sep)) throw new Error('Session evidence path escapes the run archive.');
      const info = await lstat(evidenceFile);
      const realEvidenceFile = await realpath(evidenceFile);
      if (info.isSymbolicLink() || !info.isFile() || !realEvidenceFile.startsWith(sessionEvidenceRoot + path.sep)) throw new Error('Session evidence must be a regular file inside the run archive.');
      const sessionSource = connectorQueueMode ? (ref.endsWith('connector-events.jsonl') ? 'mcp_connector_server' : 'runner_queue_adapter') : productId === 'workbuddy' && adapterConfig.entry_id === 'workbuddy-local-scheduler-uia'
        ? 'workbuddy_scheduler_uia'
        : productId === 'workbuddy' ? 'workbuddy_openapi' : 'adapter_session';
      run.evidence.push({ kind: productId === 'workbuddy' || productId === 'doubao-work' ? 'product_session' : 'api_session', path: ref.replaceAll('\\', '/'), sha256: (await digest(evidenceFile)).sha256, source: sessionSource });
      run.submission.evidence_refs.push(ref.replaceAll('\\', '/'));
    }
    for (const field of result.missing) run.missing.push({ field: `adapter.${field}`, reason: 'unknown', detail: 'Session adapter reported this field as unavailable.' });
    for (const observation of result.observations) await event('observe', observation.event, observation.status, { source: observation.source });
  } else {
    let codexHomeDir = null;
    let codexHomeCleanup = async ({ processTreeSafe = true } = {}) => null;
    if (productId === 'codex' && adapterConfig.provider_mode === 'deepseek_api') {
      const runtimeBase = path.join(os.tmpdir(), 'HarnessEvalRuntime');
      const runtimeRoot = path.join(runtimeBase, runId);
      codexHomeDir = path.join(runtimeRoot, 'codex-home');
      await mkdir(codexHomeDir, { recursive: true });
      const canonicalRuntimeBase = await realpath(runtimeBase);
      const canonicalCodexHome = await realpath(codexHomeDir);
      if (!canonicalCodexHome.startsWith(canonicalRuntimeBase + path.sep)) throw new Error('Codex runtime home resolves outside the isolated runtime directory.');
      run.environment.codex_home_ref = `system-temp/HarnessEvalRuntime/${runId}/codex-home`;
      run.environment.codex_home_cleanup = 'pending';
      codexHomeCleanup = async ({ processTreeSafe = true } = {}) => {
        if (!processTreeSafe) {
          run.environment.codex_home_cleanup = 'retained_unconfirmed_process_tree';
          return;
        }
        const currentRuntimeBase = await realpath(runtimeBase);
        const currentCodexHome = await realpath(codexHomeDir).catch(() => null);
        if (currentCodexHome && currentCodexHome.startsWith(currentRuntimeBase + path.sep)) {
          await rm(currentCodexHome, { recursive: true, force: true });
          run.environment.codex_home_cleanup = 'removed_after_process_close';
        } else {
          run.environment.codex_home_cleanup = currentCodexHome ? 'blocked_outside_runtime_root' : 'already_absent';
        }
      };
    }
    let invocation;
    try {
      invocation = adapter.buildInvocation(adapterConfig, {
        prompt, profile, runDir, workspaceDir: productWorkspace, rootDir: root, dshHome, codexHomeDir,
      });
    } catch (error) {
      await codexHomeCleanup();
      throw error;
    }
    const executable = invocation.executable;
    const renderedArgs = invocation.args;
    const isWindowsCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
    const powershell = "$adapterArgs = ConvertFrom-Json $env:ADAPTER_ARGS_JSON; & $env:ADAPTER_EXE @adapterArgs; exit $LASTEXITCODE";
    const commandLine = isWindowsCmd
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershell]]
      : [executable, renderedArgs];
    let child;
    try {
      child = spawn(commandLine[0], commandLine[1], {
        cwd: invocation.cwd ?? productWorkspace,
        env: { ...process.env, ...invocation.env, ...(codexHomeDir ? { CODEX_HOME: codexHomeDir } : {}), ADAPTER_EXE: executable, ADAPTER_ARGS_JSON: JSON.stringify(renderedArgs) },
        windowsHide: true, shell: false, stdio: [typeof invocation.stdin === 'string' ? 'pipe' : 'ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      await codexHomeCleanup();
      throw error;
    }
    const processStartedAt = now();
    let processExitAt = null;
    let processCloseAt = null;
    let spawnErrorCode = null;
    let stdinErrorCode = null;
    if (child.stdin) {
      child.stdin.on('error', error => { stdinErrorCode = error.code ?? 'stdin_error'; });
      child.stdin.end(invocation.stdin, 'utf8');
      run.submission.transformations.push({ type: 'prompt_stdin', prompt_sha256: promptHash.sha256, delivery: 'attempted' });
    }
    let stdoutLastOutputAt = null;
    let stdoutClosedAt = null;
    let stderrLastOutputAt = null;
    let stderrClosedAt = null;
    let timeoutAt = null;
    let timeoutTermination = null;
    let timeoutTask = null;
    await event('submit', 'process_starting', 'ok', { executable, profile, pid: child.pid ?? null, timestamp: processStartedAt });
    await save();
    child.once('error', error => { spawnErrorCode = error.code ?? 'spawn_error'; });
    child.once('exit', () => { processExitAt = now(); });
    child.stdout.on('data', () => { stdoutLastOutputAt = now(); });
    child.stdout.once('end', () => { stdoutClosedAt = now(); });
    child.stderr.on('data', () => { stderrLastOutputAt = now(); });
    child.stderr.once('end', () => { stderrClosedAt = now(); });
    const stdoutPath = path.join(runDir, 'stdout.log');
    const stderrPath = path.join(runDir, 'stderr.log');
    const out = await import('node:fs').then(m => m.createWriteStream(stdoutPath));
    const err = await import('node:fs').then(m => m.createWriteStream(stderrPath));
    child.stdout.pipe(out); child.stderr.pipe(err);
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutAt = now();
      timeoutTask = (async () => {
        await event('execute', 'process_timeout', 'timed_out', { pid: child.pid ?? null, timeout_seconds: timeoutSeconds, timestamp: timeoutAt });
        timeoutTermination = await terminateProcessTree(child.pid);
        await event('execute', 'process_tree_termination', timeoutTermination.status, { pid: child.pid ?? null, method: timeoutTermination.method, exit_code: timeoutTermination.exit_code ?? null, reason: timeoutTermination.reason ?? null });
      })();
    }, timeoutSeconds * 1000);
    result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, spawn_error: spawnErrorCode })));
    processCloseAt = now();
    clearTimeout(timer);
    if (timeoutTask) await timeoutTask;
    out.end(); err.end();
    await Promise.all([finished(out), finished(err)]);
    try {
      if (productId === 'codex' && adapterConfig.capture_prompt_evidence === true && codexHomeDir && !timedOut) {
        run.evidence.push(await captureCodexPromptEvidence({ home:codexHomeDir, runDir, prompt, stdoutPath }));
      }
    } finally {
      await codexHomeCleanup({ processTreeSafe: !timedOut || timeoutTermination?.process_tree_state === 'confirmed_terminated' });
    }
    run.submission.status = 'unconfirmed';
    if (stdinErrorCode) run.submission.transformations.push({ type: 'prompt_stdin_error', code: stdinErrorCode });
    run.submission.actual_prompt_ref = promptRel;
    run.submission.actual_inputs = [{ path: inputRel.replaceAll('\\', '/'), sha256: inputHash.sha256 }];
    run.execution.status = timedOut ? 'timed_out' : result.signal ? 'interrupted' : result.code === 0 ? 'completed' : 'failed';
    run.execution.completion_evidence = {
      process_id: child.pid ?? null,
      process_started_at: processStartedAt,
      process_exit_at: processExitAt,
      process_close_at: processCloseAt,
      stdout_last_output_at: stdoutLastOutputAt,
      stdout_closed_at: stdoutClosedAt,
      stderr_last_output_at: stderrLastOutputAt,
      stderr_closed_at: stderrClosedAt,
      timeout_at: timeoutAt,
      timeout_termination: timeoutTermination,
      process_exit_code: result.code,
      signal: result.signal,
      spawn_error: result.spawn_error,
      process_ended_normally: result.code === 0 && !result.signal,
      task_success_verified: false
    };
    run.execution.error = timedOut
      ? { code: 'process_timeout', message: `Process exceeded the ${timeoutSeconds}s execution limit; timeout termination was attempted.`, phase: 'execute' }
      : result.spawn_error
        ? { code: 'process_spawn_failed', message: `Process could not be started (${result.spawn_error}).`, phase: 'execute' }
      : result.code === 0 && !result.signal
        ? null
        : { code: result.signal ? 'process_terminated' : `exit_${result.code}`, message: `Process ended with code ${result.code} and signal ${result.signal ?? 'none'}.`, phase: 'execute' };
    run.evidence = [
      ...run.evidence,
      ...await Promise.all([stdoutPath, stderrPath].map(async file => ({ kind: path.basename(file, '.log'), path: path.relative(runDir, file).replaceAll('\\', '/'), sha256: (await digest(file)).sha256, source: 'launcher' }))),
    ];
    run.observations = [adapter.normalizeObservation({ stdoutRef: 'stdout.log', stderrRef: 'stderr.log', processResult: result, timedOut })];
  }
  await save();
  run.timing.ended_at = now();
  const expected = task.expected_artifacts ?? [];
  const productWorkspaceRealPath = await realpath(productWorkspace);
  if (run.execution.status === 'completed') {
    try {
      const inputInfo = await lstat(runInput);
      const actualPath = await realpath(runInput);
      if (!inputInfo.isFile() || inputInfo.isSymbolicLink() || !actualPath.startsWith(productWorkspaceRealPath + path.sep)) throw new Error('input_not_regular_workspace_file');
      const currentHash = await digest(actualPath);
      run.observations.push({ source: 'workspace_input_integrity', path: inputRel.replaceAll('\\', '/'), initial_sha256: inputHash.sha256, final_sha256: currentHash.sha256, status: currentHash.sha256 === inputHash.sha256 ? 'unchanged' : 'changed', scope: 'post_run_snapshot_only' });
    } catch (error) {
      run.observations.push({ source: 'workspace_input_integrity', path: inputRel.replaceAll('\\', '/'), initial_sha256: inputHash.sha256, final_sha256: null, status: 'unknown', reason: error.code ?? 'input_not_regular_workspace_file', scope: 'post_run_snapshot_only' });
    }
  }
  const artifactArchiveRoot = path.resolve(runDir, 'artifacts');
  const runDirRealPath = await realpath(runDir);
  if (expected.length > 0) {
    await mkdir(artifactArchiveRoot);
    const archiveRootRealPath = await realpath(artifactArchiveRoot);
    if (!archiveRootRealPath.startsWith(runDirRealPath + path.sep)) throw new Error('Artifact archive directory resolves outside the run directory.');
  }
  const seenArchivePaths = new Set();
  for (const item of expected) {
    const relative = typeof item === 'string' ? item : item.path;
    const productFile = path.resolve(productWorkspace, relative);
    const evidenceFile = path.resolve(artifactArchiveRoot, relative);
    if (!productFile.startsWith(productWorkspace + path.sep) || !evidenceFile.startsWith(artifactArchiveRoot + path.sep)) throw new Error(`Artifact path escapes its isolated workspace or archive: ${relative}`);
    if (process.platform === 'win32' && relative.split(/[\\/]/).some(segment => /[ .]$/.test(segment))) throw new Error(`Artifact path contains a Windows-ambiguous segment: ${relative}`);
    const canonicalArchivePath = process.platform === 'win32' ? evidenceFile.toLowerCase() : evidenceFile;
    if (seenArchivePaths.has(canonicalArchivePath)) throw new Error(`Multiple expected artifacts resolve to the same archive path: ${relative}`);
    seenArchivePaths.add(canonicalArchivePath);
    const externalTaskMayStillBeActive = usesSessionExecution(adapter) && run.execution.status === 'requires_action';
    if (sessionTimedOut || externalTaskMayStillBeActive || (timedOut && run.execution.completion_evidence?.timeout_termination?.process_tree_state !== 'confirmed_terminated')) {
      run.artifacts.push({ path: relative.replaceAll('\\', '/'), evidence_path: path.relative(runDir, evidenceFile).replaceAll('\\', '/'), size_bytes: null, sha256: null, collection_status: 'not_collected' });
      run.missing.push({ field: `artifact:${relative}`, reason: 'not_collected', detail: externalTaskMayStillBeActive ? 'External task may still be active or awaiting action; artifact collection was deferred to avoid a write race.' : sessionTimedOut ? 'Session timed out; artifact collection was skipped to avoid racing an unresponsive adapter.' : 'CLI timed out and process-tree termination was not confirmed; artifact collection was skipped to avoid a write race.' });
      continue;
    }
    try {
      const productFileRealPath = await realpath(productFile);
      if (!productFileRealPath.startsWith(productWorkspaceRealPath + path.sep)) {
        run.artifacts.push({ path: relative.replaceAll('\\', '/'), evidence_path: path.relative(runDir, evidenceFile).replaceAll('\\', '/'), size_bytes: null, sha256: null, collection_status: 'blocked', error: 'artifact_resolves_outside_workspace' });
        run.missing.push({ field: `artifact:${relative}`, reason: 'unsupported', detail: 'Artifact resolves outside the isolated product workspace; it was not collected.' });
        continue;
      }
      const info = await lstat(productFile);
      if (info.isSymbolicLink()) {
        run.artifacts.push({ path: relative.replaceAll('\\', '/'), evidence_path: path.relative(runDir, evidenceFile).replaceAll('\\', '/'), size_bytes: null, sha256: null, collection_status: 'blocked', error: 'symbolic_link_artifact_not_supported' });
        run.missing.push({ field: `artifact:${relative}`, reason: 'unsupported', detail: 'Symbolic-link artifacts are not collected.' });
        continue;
      }
      if (!info.isFile()) {
        run.artifacts.push({ path: relative.replaceAll('\\', '/'), evidence_path: path.relative(runDir, evidenceFile).replaceAll('\\', '/'), size_bytes: null, sha256: null, collection_status: 'blocked', error: 'artifact_is_not_a_file' });
        run.missing.push({ field: `artifact:${relative}`, reason: 'unsupported', detail: 'Expected artifact is not a regular file.' });
        continue;
      }
      await mkdir(path.dirname(evidenceFile), { recursive: true });
      await copyFile(productFile, evidenceFile);
      const hash = await digest(evidenceFile);
      run.artifacts.push({ path: relative.replaceAll('\\', '/'), evidence_path: path.relative(runDir, evidenceFile).replaceAll('\\', '/'), size_bytes: info.size, sha256: hash.sha256, collection_status: 'collected' });
    } catch (error) {
      if (error.code && !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      run.artifacts.push({ path: relative.replaceAll('\\', '/'), evidence_path: path.relative(runDir, evidenceFile).replaceAll('\\', '/'), size_bytes: null, sha256: null, collection_status: 'missing' });
      run.missing.push({ field: `artifact:${relative}`, reason: 'not_collected', detail: 'Expected file was not found.' });
    }
  }
  run.verification = { status: 'not_performed', method: null, evidence_refs: [] };
  await event('close_run', usesSessionExecution(adapter) ? 'session_closed' : 'process_closed', run.execution.status, usesSessionExecution(adapter)
    ? { execution_status: run.execution.status, submission_status: run.submission.status }
    : result);
  await recordEventEvidence();
  await save();
  await saveTrace();
  console.log(runDir);
  if (wantsVerification) {
    const verifyOutput = insideRoot(verifyOutputArg);
    if (isWithinPath(runDir, verifyOutput) || isWithinPath(verifyOutput, runDir) || isWithinPath(productWorkspace, verifyOutput) || isWithinPath(verifyOutput, productWorkspace)) throw new Error('Verification output must be separate from the run and product workspace.');
    const verifier = insideRoot(path.join('automation开发', 'scorers', 'verify-run.py'));
    const python = option(args, '--verify-python', 'python');
    const verifyArgs = [verifier, '--run-dir', runDir, '--output-dir', verifyOutput, '--artifact', verifyArtifactArg, '--text-expected-file', insideRoot(verifyExpectedArg)];
    const check = await new Promise(resolve => {
      const child = spawn(python, verifyArgs, { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', done = false, verificationTimedOut = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
      child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-16000); });
      child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
      const timer = setTimeout(() => {
        verificationTimedOut = true;
        terminateProcessTree(child.pid).then(termination => {
          if (termination.status !== 'command_succeeded') {
            try { termination.direct_child_kill_sent = child.kill(); }
            catch { termination.direct_child_kill_sent = false; }
          }
          finish({ status: 'timed_out', exit_code: null, termination });
        });
      }, verifyTimeoutSeconds * 1000);
      child.once('error', error => finish({ status: 'failed_to_start', error_code: error.code ?? 'spawn_error', exit_code: null }));
      child.once('close', code => { if (!verificationTimedOut) finish({ status: code === 0 ? 'finished' : 'failed', exit_code: code, stdout, stderr }); });
    });
    const dispatch = { event: 'verification_finished', run_id: runId, output_dir: path.relative(root, verifyOutput).replaceAll('\\', '/'), status: check.status, exit_code: check.exit_code, ...(check.error_code ? { error_code: check.error_code } : {}), ...(check.termination ? { termination: check.termination } : {}) };
    await writeFile(path.join(runDir, 'verification-dispatch.json'), JSON.stringify(dispatch, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ ...dispatch, ...(check.stdout !== undefined ? { stdout: check.stdout, stderr: check.stderr } : {}) }));
    if (check.status !== 'finished') process.exitCode = 2;
  }
  if (wantsSpreadsheetScoring) {
    const outputArg = scoreOutputArg;
    const scoreOutput = insideRoot(outputArg);
    if (isWithinPath(runDir, scoreOutput) || isWithinPath(scoreOutput, runDir) || isWithinPath(productWorkspace, scoreOutput) || isWithinPath(scoreOutput, productWorkspace)) throw new Error('Scoring output must be separate from the run and product workspace.');
    const selected = spreadsheetScoringArtifact;
    const archiveEntry = run.artifacts.find(item => item.path === selected && item.collection_status === 'collected');
    const verifier = insideRoot(path.join('automation开发', 'scorers', 'verify-run.py'));
    const python = option(args, '--verify-python', 'python');
    const verifyArgs = [verifier, '--run-dir', runDir, '--output-dir', scoreOutput, '--artifact', selected];
    if (archiveEntry) {
      const archivedArtifact = path.resolve(runDir, archiveEntry.evidence_path);
      await assertRealPathInsideRoot(archivedArtifact, 'Archived SpreadsheetBench artifact');
      verifyArgs.push('--answer', insideRoot(scoreAnswerArg), '--recalculated-output', archivedArtifact,
        '--recalculated-from-sha256', archiveEntry.sha256,
        '--recalculation-method', 'Product-saved workbook cached values; no independent recalculation was performed.',
        '--evaluator', insideRoot(scoreEvaluatorArg), '--evaluator-revision', scoreRevisionArg,
        '--timeout', String(verifyTimeoutSeconds));
    }
    const check = await new Promise(resolve => {
      const child = spawn(python, verifyArgs, { cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
      child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-16000); });
      child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
      const timer = setTimeout(() => {
        terminateProcessTree(child.pid).then(termination => {
          if (termination.status !== 'command_succeeded') {
            try { termination.direct_child_kill_sent = child.kill(); } catch { termination.direct_child_kill_sent = false; }
          }
          finish({ status: 'timed_out', exit_code: null, termination });
        });
      }, verifyTimeoutSeconds * 1000);
      child.once('error', error => finish({ status: 'failed_to_start', error_code: error.code ?? 'spawn_error' }));
      child.once('close', code => finish({ status: code === 0 ? 'finished' : 'failed', exit_code: code, stdout, stderr }));
    });
    let verificationResult = null;
    if (check.stdout) {
      try { verificationResult = JSON.parse(check.stdout.trim().split(/\r?\n/).at(-1)); }
      catch { verificationResult = null; }
    }
    const dispatchStatus = check.status === 'failed' && verificationResult ? 'finished' : check.status;
    const dispatch = { event: 'spreadsheetbench_scoring_finished', run_id: runId, output_dir: path.relative(root, scoreOutput).replaceAll('\\', '/'), artifact: selected, status: dispatchStatus, exit_code: check.exit_code, ...(verificationResult ? { verification_result: verificationResult } : {}), ...(check.error_code ? { error_code: check.error_code } : {}), ...(check.termination ? { termination: check.termination } : {}) };
    await writeFile(path.join(runDir, 'scoring-dispatch.json'), JSON.stringify(dispatch, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ ...dispatch, ...(check.stdout !== undefined ? { stdout: check.stdout, stderr: check.stderr } : {}) }));
    if (dispatchStatus === 'failed_to_start' || dispatchStatus === 'timed_out') process.exitCode = 2;
    else if (check.exit_code !== 0) process.exitCode = 1;
  }
}
