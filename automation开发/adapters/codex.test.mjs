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
