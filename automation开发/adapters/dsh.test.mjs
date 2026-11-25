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
