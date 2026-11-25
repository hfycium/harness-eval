import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { publishTask } from '../connectors/workbuddy-eval/publish-task.mjs';
import { expirePending, inspectQueue } from '../connectors/workbuddy-eval/queue-lifecycle.mjs';
import { extract, locateSession } from './workbuddy/extract-session-evidence.mjs';
import { collectDoubaoEvidence } from './doubao-work/extract-session-evidence.mjs';

const QUEUE_ENV = 'HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT';
const WORKSPACE_ENV = 'HARNESS_EVAL_WORKBUDDY_ROOT';
const DEFAULT_EVIDENCE_DIR = 'workbuddy-queue';
const idHash = value => createHash('sha256').update(path.resolve(value)).digest('hex');

export class WorkBuddyQueueAdapter {
  constructor({ productId = 'workbuddy', evidenceDir = DEFAULT_EVIDENCE_DIR, taskExecutionProtocol = 'runner_injected_workbuddy_eval_execution_v1' } = {}) {
    this.productId = productId;
    this.evidenceDir = evidenceDir;
    this.taskExecutionProtocol = taskExecutionProtocol;
  }

  snapshotConfig(config) {
    const queue = process.env[QUEUE_ENV];
    const workspace = process.env[WORKSPACE_ENV];
    return {
      entry_id: config.entry_id, execution_method: 'mcp_connector_queue',
      instrumented_connector: true, trigger_source: config.trigger_source ?? 'unknown',
      queue_root_configured: Boolean(queue), queue_root_identifier_sha256: queue ? idHash(queue) : null,
      workspace_root_configured: Boolean(workspace), workspace_root_identifier_sha256: workspace ? idHash(workspace) : null,
      queue_root_match_with_connector: 'unconfirmed', poll_interval_seconds: config.poll_interval_seconds ?? 2,
      coordinated_expiry: config.coordinated_expiry === true,
      task_execution_protocol: this.taskExecutionProtocol,
      native_skill_installation: 'unknown',
      session_evidence_requested: config.session_evidence === true,
      internal_trace: 'unavailable',
    };
  }

  permissionDescription() { return { requested_workspace: 'dedicated_' + this.productId.replaceAll('-', '_') + '_root', runtime_scope_confirmation: 'unknown', automatic_permission_response: false }; }

  preflight(config, { timeoutSeconds }) {
    const missing = [];
    for (const name of [QUEUE_ENV, WORKSPACE_ENV]) if (!process.env[name] || !path.isAbsolute(process.env[name])) missing.push(name);
    if (config.workspace_root_env !== WORKSPACE_ENV) missing.push('workspace_root_env');
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) missing.push('timeout_seconds');
    if (!['manual', 'scheduled', 'unknown'].includes(config.trigger_source ?? 'unknown')) missing.push('trigger_source');
    return missing.length ? { status: 'not_admitted', missing, reason: 'Queue mode requires absolute queue/workspace environment roots, a valid trigger source and a positive integer timeout.' } : { status: 'ready', missing: [] };
  }

  async runSession(context) {
    const evidenceDir = path.join(context.runDir, this.evidenceDir);
    const journalRef = this.evidenceDir + '/queue-events.jsonl';
    const journal = path.join(context.runDir, journalRef);
    await mkdir(evidenceDir, { recursive: true });
    const observe = async (event, status, extra = {}) => appendFile(journal, `${JSON.stringify({ timestamp: new Date().toISOString(), source: 'runner_queue_adapter', run_id: context.runId, event, status, ...extra })}\n`, 'utf8');
    const task = {
      run_id: context.runId, case_id: context.caseId, prompt: context.prompt,
      workspace_dir: context.workspaceDir,
      inputs: [{ path: context.inputRelativePath.replaceAll('\\', '/'), sha256: context.inputSha256 }],
      expected_artifacts: context.expectedArtifacts, timeout_seconds: context.timeoutSeconds,
    };
    const published = await publishTask(task, { queueRoot: process.env[QUEUE_ENV], authorizedRoot: process.env[WORKSPACE_ENV] });
    await observe('publish', 'queued', { task_sha256: published.task_sha256 });
    process.stdout.write(`${JSON.stringify({ event: 'workbuddy_queue_published', run_id: context.runId, case_id: context.caseId, timeout_seconds: context.timeoutSeconds, task_sha256: published.task_sha256 })}\n`);
    const queueDir = path.join(process.env[QUEUE_ENV], 'queue');
    const claimedPath = path.join(queueDir, 'claimed', `${context.runId}.json`);
    const resultPath = path.join(queueDir, 'results', `${context.runId}.json`);
    const missing = ['effective_model', 'effective_mode', 'runtime_skill_state', 'runtime_permission_state', 'internal_trace', 'task_success_not_independently_verified'];
    const observations = [{ source: 'runner_queue_adapter', event: 'publish', status: 'queued' }];
    let claimed = false;
    const interval = Math.max(500, Math.min(30000, Number(context.config.poll_interval_seconds ?? 2) * 1000 || 2000));
    try {
    while (!context.signal.aborted) {
      if (!claimed) {
        try {
          const record = JSON.parse(await readFile(claimedPath, 'utf8'));
          if (record.run_id !== context.runId || record.task_sha256 !== published.task_sha256) throw new Error('claimed_record_mismatch');
          if (['claimed', 'submitted', 'blocked'].includes(record.status)) {
            claimed = true;
            await observe('claim', 'claimed');
            observations.push({ source: 'runner_queue_adapter', event: 'claim', status: 'claimed' });
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      try {
        const result = JSON.parse(await readFile(resultPath, 'utf8'));
        if (!claimed || result.run_id !== context.runId || result.case_id !== context.caseId || !['submitted', 'blocked'].includes(result.status)) throw new Error('result_record_mismatch');
        const resultRef = this.evidenceDir + '/result-summary.json';
        await writeFile(path.join(context.runDir, resultRef), JSON.stringify({ run_id: result.run_id, case_id: result.case_id, status: result.status, artifacts_observed_by_connector: result.artifacts_observed_by_connector, independent_task_verification: result.independent_task_verification }, null, 2) + '\n');
        await observe('result', result.status);
        observations.push({ source: 'runner_queue_adapter', event: 'result', status: result.status });
        const refs = [journalRef, resultRef];
        const connectorLog = path.join(queueDir, 'events', `${context.runId}.jsonl`);
        try {
          if ((await stat(connectorLog)).isFile()) {
            const ref = this.evidenceDir + '/connector-events.jsonl';
            await copyFile(connectorLog, path.join(context.runDir, ref));
            refs.push(ref);
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (this.productId === 'workbuddy' && context.config.session_evidence === true) {
          const sourceRoot = process.env.HARNESS_EVAL_WORKBUDDY_PROJECTS_DIR;
          let captured = false;
          if (sourceRoot && path.isAbsolute(sourceRoot)) {
            for (let attempt=0; attempt<4 && !captured; attempt++) {
              try {
                const source = await locateSession(sourceRoot, context.runId);
                await extract({source, runId:context.runId, outputDir:path.join(evidenceDir,'client-tool'), outputRoot:evidenceDir});
                refs.push(this.evidenceDir + '/client-tool/tool-evidence.json');
                await observe('client_tool_evidence','captured');
                observations.push({source:'workbuddy_local_session_jsonl',event:'tool_evidence',status:'captured'});
                captured = true;
              } catch { if(attempt<3) await new Promise(resolve=>setTimeout(resolve,500)); }
            }
          }
          if (!captured) { await observe('client_tool_evidence','unknown'); missing.push('client_tool_evidence_unavailable'); }
        }
        if (this.productId === 'doubao-work' && context.config.session_evidence === true) {
          const sourceRoot = process.env.HARNESS_EVAL_DOUBAO_SESSIONS_DIR;
          let captured = false;
          if (context.caseId === 'tracetrial-e8-cmd' && sourceRoot && path.isAbsolute(sourceRoot)) {
            for (let attempt=0; attempt<4 && !captured; attempt++) {
              try {
                await collectDoubaoEvidence({sessionsDir:sourceRoot, runId:context.runId, outputDir:path.join(evidenceDir,'client-tool')});
                refs.push(this.evidenceDir + '/client-tool/tool-evidence.json');
                await observe('client_tool_evidence','captured');
                observations.push({source:'doubao_work_local_session_jsonl',event:'tool_evidence',status:'captured'});
                captured = true;
              } catch { if(attempt<3) await new Promise(resolve=>setTimeout(resolve,500)); }
            }
          }
          if (!captured) { await observe('client_tool_evidence','unknown'); missing.push('client_tool_evidence_unavailable'); }
        }
        return {
          submission_status: 'submitted', submission_evidence: { prompt_submitted: true, prompt_ref: 'prompt.md', inputs: task.inputs },
          execution_status: result.status === 'submitted' ? 'completed' : 'requires_action',
          completion_evidence: { task_success_verified: false, remote_status: result.status }, observations, missing, evidence_refs: refs,
          error: result.status === 'blocked' ? { code: 'connector_reported_blocked', phase: 'execute' } : null,
        };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => {
        const timer = setTimeout(done, interval);
        function done() { clearTimeout(timer); context.signal.removeEventListener('abort', done); resolve(); }
        context.signal.addEventListener('abort', done, { once: true });
        if (context.signal.aborted) done();
      });
    }
    await observe('wait', 'timed_out');
    } catch (error) {
      await observe('queue_error', 'requires_action', { error_code: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'queue_state_unconfirmed' });
      throw error;
    } finally {
      if (context.signal.aborted) {
        try {
          const state = context.config.coordinated_expiry === true
            ? await expirePending(process.env[QUEUE_ENV], context.runId, published.task_sha256)
            : { status: 'manual_reconciliation_required', states: await inspectQueue(process.env[QUEUE_ENV], context.runId) };
          await observe('timeout_reconciliation', state.status, state.states ? { states: state.states } : {});
        } catch (error) {
          await observe('timeout_reconciliation', 'error', { error_code: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'reconciliation_failed' });
        }
      }
    }
    throw new Error('queue_wait_aborted');
  }
}
