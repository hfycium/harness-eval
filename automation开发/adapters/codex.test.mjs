import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexAdapter } from './codex.mjs';

test('Codex passes multiline task through standard input', () => {
  const prompt = 'first line\nsecond line with "quotes" and %symbols%';
  const result = new CodexAdapter().buildInvocation({executable:'codex.cmd'}, {prompt, workspaceDir:process.cwd()});
  assert.equal(result.stdin, prompt);
  assert.equal(result.args.at(-1), '-');
  assert.equal(result.args.includes(prompt), false);
  assert.equal(result.args.includes('--ephemeral'), true);
  const evidenceRun = new CodexAdapter().buildInvocation({executable:'codex.cmd', provider_mode:'deepseek_api', capture_prompt_evidence:true}, {prompt, workspaceDir:process.cwd(), codexHomeDir:process.cwd()});
  assert.equal(evidenceRun.args.includes('--ephemeral'), false);
});

test('ChatGPT account model is optional, passed explicitly, and never assumed effective', () => {
  const adapter = new CodexAdapter(), context = {prompt:'test', workspaceDir:process.cwd()};
  const config = {executable:'codex.cmd', provider_mode:'chatgpt_account', model:'gpt-6-luna'};
  const args = adapter.buildInvocation(config, context).args;
  assert.equal(args[args.indexOf('--model')+1], 'gpt-6-luna');
  assert.equal(adapter.modelCondition(config).requested_model, 'gpt-6-luna');
  assert.equal(adapter.modelCondition(config).effective_model, null);
  assert.equal(adapter.buildInvocation({executable:'codex.cmd'}, context).args.includes('--model'), false);
  assert.equal(adapter.preflight({...config, model:'--unsafe'}, {timeoutSeconds:30}).status, 'not_admitted');
  assert.throws(() => adapter.buildInvocation({...config, model:'--unsafe'}, context));
  const diagnostic={...config,account_session_diagnostic:true};
  assert.equal(adapter.buildInvocation(diagnostic,context).args.includes('--ephemeral'),false);
  assert.equal(adapter.snapshotConfig(diagnostic).account_session_diagnostic,true);
  assert.equal(adapter.preflight({...diagnostic,provider_mode:'deepseek_api'}, {timeoutSeconds:30}).status,'not_admitted');
});
