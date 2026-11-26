import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import {codexModelCommand} from './codex-model-config.mjs';

test('model switcher writes a local config, shows it, and resets to template',async()=>{
  let current=await codexModelCommand('show');
  try {
    await codexModelCommand('set','model-test-7');
    current=await codexModelCommand('show');
    assert.equal(current.model,'model-test-7');
    const config=JSON.parse(await readFile(current.config_path,'utf8'));
    assert.equal(config.provider_mode,'chatgpt_account');
    await assert.rejects(()=>codexModelCommand('set','--bad'),/Usage/);
  } finally { await rm(current.config_path,{force:true}); }
});
