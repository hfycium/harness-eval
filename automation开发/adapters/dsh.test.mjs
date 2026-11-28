import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DshAdapter } from './dsh.mjs';

test('DSH JSON events are explicit and preserved in snapshot', () => {
  const adapter = new DshAdapter();
  const context = { profile:'headless', prompt:'hello', rootDir:process.cwd(), workspaceDir:process.cwd(), runDir:process.cwd() };
  const config = { executable:'dsh.cmd', json_events:true };
  assert.deepEqual(adapter.buildInvocation(config,context).args, ['--profile','headless','--json','-']);
  assert.equal(adapter.buildInvocation(config,context).stdin, 'hello');
  assert.equal(adapter.snapshotConfig(config).json_events, true);
  assert.equal(adapter.buildInvocation({executable:'dsh.cmd'},context).args.includes('--json'), false);
});

test('DSH ChatAnywhere patch records requested route and blocks missing credential', () => {
  const adapter = new DshAdapter();
  const config = { executable:'dsh.cmd', profile:'headless', model_patch:'automation开发/configs/dsh.chatanywhere-high.patch.yml', api_key_env:'CHATANYWHERE_API_KEY' };
  const context = { profile:'headless', prompt:'hello', rootDir:process.cwd(), workspaceDir:process.cwd(), runDir:process.cwd() };
  const condition = adapter.modelCondition(config);
  assert.equal(condition.provider_id, 'chatanywhere');
  assert.equal(condition.requested_model, 'deepseek-v4.1-flash-1017');
  assert.equal(condition.requested_reasoning_effort, 'high');
  assert.equal(condition.effective_model, null);
  assert.equal(adapter.preflight(config, { profile:'headless', timeoutSeconds:30 }).status, 'not_admitted');
  assert.ok(adapter.buildInvocation(config, context).args.includes('--patch'));
});
