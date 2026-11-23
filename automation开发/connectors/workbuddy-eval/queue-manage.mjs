#!/usr/bin/env node
import { inspectQueue, expirePending } from './queue-lifecycle.mjs';

function option(args, name) { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; }
async function main(args) {
  const [command] = args;
  const runId = option(args, '--run-id');
  const root = process.env.HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT;
  if (!['status', 'expire'].includes(command) || !runId || !root) throw new Error('Usage: set HARNESS_EVAL_WORKBUDDY_QUEUE_ROOT, then queue-manage.mjs status|expire --run-id <id> [--task-sha256 <hash> --consumer-stopped]');
  if (command === 'status') return console.log(JSON.stringify({ run_id: runId, states: await inspectQueue(root, runId) }));
  const hash = option(args, '--task-sha256');
  if (!args.includes('--consumer-stopped') || !/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error('expire requires --consumer-stopped and the recorded --task-sha256; stop every WorkBuddy queue consumer first.');
  const result = await expirePending(root, runId, hash);
  console.log(JSON.stringify({ run_id: runId, ...result }));
  if (!['expired', 'already_expired'].includes(result.status)) process.exitCode = 2;
}
main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
