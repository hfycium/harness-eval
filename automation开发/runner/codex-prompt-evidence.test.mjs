import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureCodexPromptEvidence } from './codex-prompt-evidence.mjs';

test('captures only exact user message and reports mismatches as unknown', async () => {
  const base=await mkdtemp(path.join(os.tmpdir(),'codex-prompt-test-'));
  try {
    const home=path.join(base,'home'),run=path.join(base,'run'),other=path.join(base,'other');
    await mkdir(path.join(home,'sessions'),{recursive:true}); await mkdir(run); await mkdir(other);
    const stdoutPath=path.join(base,'stdout.log');
    await writeFile(stdoutPath, JSON.stringify({type:'thread.started',thread_id:'abcd-12345678'})+'\n');
    const event={type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'first\nsecond'}]}};
    await writeFile(path.join(home,'sessions','rollout-abcd-12345678.jsonl'),JSON.stringify(event)+'\n');
    await captureCodexPromptEvidence({home,runDir:run,prompt:'first\nsecond',stdoutPath});
    const found=JSON.parse(await readFile(path.join(run,'codex-prompt-evidence.json'),'utf8'));
    assert.equal(found.status,'matched'); assert.equal(found.initial_user_text,'first\nsecond');
    await captureCodexPromptEvidence({home,runDir:other,prompt:'different',stdoutPath});
    const missing=JSON.parse(await readFile(path.join(other,'codex-prompt-evidence.json'),'utf8'));
    assert.equal(missing.status,'unknown'); assert.equal(missing.initial_user_text,null);
  } finally {
    if (path.dirname(path.resolve(base)) !== path.resolve(os.tmpdir()) || !path.basename(base).startsWith('codex-prompt-test-')) throw Error('unsafe test directory');
    await rm(base,{recursive:true,force:true});
  }
});
