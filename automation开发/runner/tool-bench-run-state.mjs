import { copyFile, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

export const TOOL_BENCH_CONTROL_ENV = 'HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT';
export const TOOL_BENCH_URL_ENV = 'TOOL_BENCH_MCP_URL';
export const TOOL_BENCH_SSH_TARGET_ENV = 'TOOL_BENCH_SSH_TARGET';
export const TOOL_BENCH_EXPECTED_TOOLS_ENV = 'TOOL_BENCH_EXPECTED_TOOLS_SHA256';

function within(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function activateToolBenchRun({ runId, timeoutSeconds, projectRoot, workspaceDir }) {
  const controlRoot = process.env[TOOL_BENCH_CONTROL_ENV];
  if (!controlRoot || !path.isAbsolute(controlRoot)) throw new Error(`${TOOL_BENCH_CONTROL_ENV} must be an absolute dedicated directory.`);
  await mkdir(controlRoot, { recursive: true });
  const canonicalRoot = await realpath(controlRoot);
  const canonicalProject = await realpath(projectRoot);
  const canonicalWorkspace = await realpath(workspaceDir);
  if (within(canonicalProject, canonicalRoot) || within(canonicalRoot, canonicalProject) || within(canonicalWorkspace, canonicalRoot) || within(canonicalRoot, canonicalWorkspace)) {
    throw new Error('Tool-Bench control root must be separate from both the repository and product workspace.');
  }
  const activePath = path.join(canonicalRoot, 'active-run.json');
  try {
    const existing = JSON.parse(await readFile(activePath, 'utf8'));
    const stillActive = Date.parse(existing?.expires_at ?? '') > Date.now();
    throw new Error(stillActive ? 'Another Tool-Bench run is active in the shared control root.' : 'An expired Tool-Bench active-run record requires manual reconciliation before reuse.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const state = {
    run_id: runId,
    log_file: `${runId}.jsonl`,
    expires_at: new Date(Date.now() + (timeoutSeconds + 120) * 1000).toISOString(),
  };
  await writeFile(activePath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  return { controlRoot: canonicalRoot, activePath, state };
}

export async function archiveAndDeactivateToolBenchRun({ active, runDir, closeTransport = async () => null }) {
  if (!active) return null;
  const expected = JSON.stringify(active.state);
  const current = JSON.parse(await readFile(active.activePath, 'utf8'));
  if (JSON.stringify(current) !== expected) throw new Error('Tool-Bench active-run record changed during execution; manual reconciliation is required.');
  const source = path.resolve(active.controlRoot, active.state.log_file);
  if (!within(active.controlRoot, source) || source === active.controlRoot) throw new Error('Tool-Bench event log escapes its control root.');
  await unlink(active.activePath);
  const transportEvidence = await closeTransport();
  await new Promise(resolve => setTimeout(resolve, 250));
  const targetDir = path.join(runDir, 'tool-bench-mcp');
  const target = path.join(targetDir, 'events.jsonl');
  let archived = false;
  try {
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Tool-Bench event log must be a regular file.');
    await mkdir(targetDir, { recursive: true });
    await copyFile(source, target);
    archived = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { event_log_ref: archived ? 'tool-bench-mcp/events.jsonl' : null, transport_evidence: transportEvidence };
}

function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

export async function startToolBenchTunnel({ target = process.env[TOOL_BENCH_SSH_TARGET_ENV], port = 17123 } = {}) {
  if (typeof target !== 'string' || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(target)) throw new Error(`${TOOL_BENCH_SSH_TARGET_ENV} must be user@host.`);
  const executable = process.env.TOOL_BENCH_SSH_EXECUTABLE ?? 'ssh';
  const args = [
    '-N', '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${port}:127.0.0.1:${port}`,
    target,
  ];
  const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  let exit = null;
  child.once('close', (code, signal) => { exit = { code, signal }; });
  child.once('error', error => { exit = { code: null, signal: null, error_code: error.code ?? 'spawn_error' }; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (exit) throw new Error(`SSH tunnel exited before becoming ready (${exit.error_code ?? exit.code ?? exit.signal ?? 'unknown'}).`);
    if (await canConnect(port)) return { child, port, target, get stderr() { return stderr; } };
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error('SSH tunnel did not open the loopback port within 10 seconds.');
}

export async function stopToolBenchTunnel(tunnel, runDir) {
  if (!tunnel) return null;
  if (tunnel.child.exitCode === null && tunnel.child.signalCode === null) tunnel.child.kill();
  await Promise.race([
    new Promise(resolve => tunnel.child.once('close', resolve)),
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);
  const evidenceDir = path.join(runDir, 'tool-bench-mcp');
  await mkdir(evidenceDir, { recursive: true });
  const logPath = path.join(evidenceDir, 'ssh-tunnel.stderr.log');
  await writeFile(logPath, tunnel.stderr ?? '', 'utf8');
  return {
    pid: tunnel.child.pid ?? null,
    exit_code: tunnel.child.exitCode,
    signal: tunnel.child.signalCode,
    log_ref: 'tool-bench-mcp/ssh-tunnel.stderr.log',
  };
}
