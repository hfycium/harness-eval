import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAdapters } from '../adapters/registry.mjs';
import { completedBatchStatus } from './batch-status.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const batchRoot = path.join(root, 'runs', '批次');
const now = () => new Date().toISOString();
const relative = p => path.relative(root, p).replaceAll('\\', '/');
const inside = (base, p) => p === base || p.startsWith(base + path.sep);
const file = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是仓库内路径`);
  const resolved = path.resolve(root, value);
  if (!inside(root, resolved)) throw new Error(`${name} 必须在仓库内`);
  return resolved;
};
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const optionalJson = async p => { try { return await json(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const atomic = async (p, data) => { const temp = `${p}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); await rename(temp, p); };
const id = () => `batch-${new Date().toISOString().replaceAll(':','').replaceAll('.','-')}-${randomUUID().slice(0,8)}`;

async function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.jobs) || !plan.jobs.length) throw new Error('计划 jobs 必须为非空数组');
  if (!['stop', 'continue'].includes(plan.on_failure ?? 'stop')) throw new Error('on_failure 只能为 stop 或 continue');
  for (const [i, job] of plan.jobs.entries()) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) throw new Error(`jobs[${i}] 无效`);
    const allowed = ['case', 'harness', 'config', 'timeout', 'verification'];
    if (Object.keys(job).some(k => !allowed.includes(k))) throw new Error(`jobs[${i}] 含不支持的字段`);
    if (!listAdapters().includes(job.harness)) throw new Error(`jobs[${i}] Harness 未注册`);
    if (!Number.isInteger(job.timeout) || job.timeout < 1 || job.timeout > 86400) throw new Error(`jobs[${i}] timeout 必须为 1–86400 秒`);
    for (const [name, value] of [['case', job.case], ['config', job.config]]) {
      const p = file(value, name);
      if (!inside(await realpath(root), await realpath(p))) throw new Error(`${name} 真实路径位于仓库外`);
    }
    const config = await json(file(job.config, 'config'));
    if (config.product_id !== job.harness) throw new Error(`jobs[${i}] 产品与配置不一致`);
    const c = await json(file(job.case, 'case'));
    if (!c.case_id || !Array.isArray(c.expected_artifacts)) throw new Error(`jobs[${i}] case 不完整`);
    if (job.verification) {
      const v = job.verification;
      if (v.type === 'tracetrial_e8_cmd') {
        if (Object.keys(v).some(k => k !== 'type') || c.case_id !== 'tracetrial-e8-cmd') throw new Error(`jobs[${i}] E8 验收配置或题目不匹配`);
      } else {
        if (v.type !== 'text_exact' || Object.keys(v).some(k => !['type','artifact','expected','python'].includes(k))) throw new Error(`jobs[${i}] 验收类型不支持`);
        if (!c.expected_artifacts.includes(v.artifact)) throw new Error(`jobs[${i}] 验收文件未在 case 声明`);
        const expected = file(v.expected, 'expected');
        if (!inside(await realpath(root), await realpath(expected))) throw new Error('验收文件真实路径位于仓库外');
        if (v.python !== undefined && (typeof v.python !== 'string' || !v.python)) throw new Error('python 必须是可执行路径');
      }
    }
  }
}

async function collect(job) {
  const runDir = path.join(root, 'runs', '自动化', job.run_id);
  const run = await optionalJson(path.join(runDir, 'run.json'));
  const task = run ? await optionalJson(path.join(runDir, 'case.json')) : null;
  const verification = job.verification_dir ? await optionalJson(path.join(root, job.verification_dir, 'verification.json')) : null;
  const score = job.verification_dir ? await optionalJson(path.join(root, job.verification_dir, 'score.json')) : null;
  let latestEvent = null;
  for (const ref of ['events.jsonl', job.harness === 'workbuddy' ? 'workbuddy-queue/queue-events.jsonl' : job.harness === 'doubao-work' ? 'doubao-work-queue/queue-events.jsonl' : null]) {
    if (!ref) continue;
    try {
      const lines = (await readFile(path.join(runDir, ref), 'utf8')).trim().split(/\r?\n/);
      const event = JSON.parse(lines.at(-1));
      if (!latestEvent || String(event.timestamp ?? '') >= String(latestEvent.timestamp ?? '')) latestEvent = { source: ref, event: event.event ?? null, status: event.status ?? event.result ?? null, timestamp: event.timestamp ?? null };
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  }
  const required = (task?.expected_artifacts ?? []).filter(x => typeof x === 'string' || x?.required !== false).map(x => typeof x === 'string' ? x : x.path);
  const artifactStatus = !run || !task ? 'unknown' : required.length === 0 ? 'not_applicable' : required.every(p => (run.artifacts ?? []).some(a => a.path === p && a.collection_status === 'collected')) ? 'collected' : 'missing';
  return { run_path: run ? relative(runDir) : null, execution: run?.execution?.status ?? 'unknown', execution_error: run?.execution?.error?.code ?? null, submission: run?.submission?.status ?? 'unknown', latest_event: latestEvent, artifact_status: artifactStatus, artifacts: run?.artifacts ?? [], requested_model: run?.model_condition?.requested_model ?? null, effective_model: run?.model_condition?.effective_model ?? null, verification: verification?.task_correctness ?? 'not_performed', verification_path: verification ? `${job.verification_dir}/verification.json` : null, archive: verification?.archive_status ?? 'not_checked', scoring: score?.status ?? 'not_requested', scoring_reason: score?.reason ?? null };
}

async function report(dir, state) {
  const rows = [];
  for (const job of state.jobs) rows.push({ index: job.index, harness: job.harness, case: job.case, status: job.status, exit_code: job.exit_code ?? null, ...(await collect(job)) });
  const summary = { batch_id: state.batch_id, status: state.status, generated_at: now(), on_failure: state.on_failure, jobs: rows };
  await atomic(path.join(dir, 'summary.json'), summary);
  const clean = x => String(x ?? 'unknown').replace(/[\r\n|]/g, ' ');
  const table = ['# 批次汇总', '', `批次：${state.batch_id}`, `状态：${state.status}`, '', '| 序号 | 产品 | 任务 | 调度 | 执行 | 提交 | 验收 | 评分 | 运行记录 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const x of rows) table.push(`| ${x.index} | ${clean(x.harness)} | ${clean(x.case)} | ${clean(x.status)} | ${clean(x.execution)} | ${clean(x.submission)} | ${clean(x.verification)} | ${clean(x.scoring)} | ${clean(x.run_path)} |`);
  table.push('', '评分 blocked 可能表示无 benchmark 评分；任务验收单独查看。各产品可观测内容不同。', '');
  await writeFile(path.join(dir, 'summary.md'), table.join('\n'), 'utf8');
  return summary;
}

async function run(planPath) {
  const plan = await json(file(planPath, 'plan'));
  await validatePlan(plan);
  await mkdir(batchRoot, { recursive: true });
  const batchId = id();
  const dir = path.join(batchRoot, batchId);
  await mkdir(dir);
  const state = { batch_id: batchId, status: 'running', created_at: now(), on_failure: plan.on_failure ?? 'stop', jobs: plan.jobs.map((j, i) => ({ index: i + 1, ...j, run_id: `${batchId}-${String(i + 1).padStart(3,'0')}`, status: 'pending', verification_dir: j.verification ? relative(path.join(dir, `verification-${String(i + 1).padStart(3,'0')}`)) : null })) };
  const statePath = path.join(dir, 'batch.json');
  await atomic(statePath, state);
  await report(dir, state);
  console.log(`批次目录：${dir}`);
  let interrupted = false;
  let activeChild = null;
  const handleInterrupt = () => {
    interrupted = true;
    console.error('收到中断：停止批次，产品任务和子进程状态需人工核对，禁止自动重发。');
    if (activeChild) activeChild.kill();
  };
  process.on('SIGINT', handleInterrupt);
  for (const job of state.jobs) {
    if (interrupted) { state.status = 'needs_reconciliation'; break; }
    job.status = 'running'; job.started_at = now();
    await atomic(statePath, state); await report(dir, state);
    console.log(`\n[${job.index}/${state.jobs.length}] ${job.harness} ${job.case}；运行 ID：${job.run_id}`);
    if (['workbuddy','doubao-work','yuanbao-web'].includes(job.harness)) console.log('此产品可能需要人工登录、领取或确认；请按下方提示操作。');
    const args = [path.join(root, 'automation开发', 'run-eval.mjs'), 'run', '--case', job.case, '--harness', job.harness, '--config', job.config, '--timeout', String(job.timeout), '--run-id', job.run_id];
    if (job.verification?.type === 'text_exact') args.push('--verify-text-artifact', job.verification.artifact, '--verify-text-expected', job.verification.expected, '--verification-output', job.verification_dir, ...(job.verification.python ? ['--verify-python', job.verification.python] : []));
    const outcome = await new Promise(resolve => {
      const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false });
      activeChild = child;
      let done = false;
      const finish = value => { if (!done) { done = true; activeChild = null; resolve(value); } };
      child.once('error', e => finish({ code: null, error: e.code ?? 'spawn_error' }));
      child.once('close', (code, signal) => finish({ code, signal }));
    });
    job.exit_code = outcome.code;
    if (!interrupted && job.verification?.type === 'tracetrial_e8_cmd' && outcome.code === 0) {
      const verifier = path.join(root, 'automation开发', 'scorers', 'score-tracetrial-e8.mjs');
      job.verifier_exit_code = await new Promise(resolve => {
        const child = spawn(process.execPath, [verifier, '--run-dir', path.join(root, 'runs', '自动化', job.run_id), '--output-dir', path.join(root, job.verification_dir)], { cwd: root, stdio: 'inherit', shell: false });
        child.once('error', () => resolve(null)); child.once('close', code => resolve(code));
      });
    }
    job.ended_at = now();
    const result = await collect(job);
    const unknown = interrupted || !result.run_path || ['requires_action', 'timed_out', 'running', 'interrupted'].includes(result.execution);
    const review = job.verification?.type === 'tracetrial_e8_cmd' && result.verification === 'unknown' && job.verifier_exit_code === 0;
    const verifierBlocked = job.verification?.type === 'tracetrial_e8_cmd' && job.verifier_exit_code !== 0;
    job.status = unknown || verifierBlocked ? 'needs_reconciliation' : review ? 'needs_review' : (outcome.code === 0 && result.execution === 'completed' && ['collected','not_applicable'].includes(result.artifact_status) && (!job.verification || result.verification === 'passed') ? 'completed' : 'failed');
    job.error = outcome.error ?? (outcome.signal ? `signal_${outcome.signal}` : null);
    await atomic(statePath, state); await report(dir, state);
    console.log(`第 ${job.index} 项：${job.status}；验收：${result.verification}`);
    if (job.status === 'needs_reconciliation' || (job.status === 'failed' && state.on_failure === 'stop')) { state.status = job.status === 'needs_reconciliation' ? 'needs_reconciliation' : 'stopped_on_failure'; break; }
  }
  process.removeListener('SIGINT', handleInterrupt);
  if (state.status === 'running') state.status = completedBatchStatus(state.jobs);
  state.ended_at = now(); await atomic(statePath, state); await report(dir, state);
  console.log(`批次结束：${state.status}；汇总：${path.join(dir, 'summary.md')}`);
  if (state.status !== 'completed') process.exitCode = state.status === 'completed_needs_review' ? 2 : 1;
}

async function inspect(batchArg) {
  const dir = file(batchArg, 'batch');
  const realDir = await realpath(dir);
  if (!inside(await realpath(batchRoot), realDir)) throw new Error('批次目录必须位于 runs/批次');
  const state = await json(path.join(dir, 'batch.json'));
  const summary = await report(dir, state);
  console.log(JSON.stringify(summary, null, 2));
}

const [action, ...args] = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
try {
  if (action === 'run' && value('--plan')) await run(value('--plan'));
  else if (action === 'summary' && value('--batch')) await inspect(value('--batch'));
  else throw new Error('用法: node automation开发/runner/batch.mjs run --plan <计划.json> | summary --batch <批次目录>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
