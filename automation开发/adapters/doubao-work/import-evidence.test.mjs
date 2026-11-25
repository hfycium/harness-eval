import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importEvidence } from './import-evidence.mjs';

test('imports operator evidence without changing source or run and rejects wrong identity and overwrite', async () => {
  const base=await mkdtemp(path.join(os.tmpdir(),'doubao-evidence-test-'));
  try {
    const run=path.join(base,'runs','自动化','run-1'), review=path.join(base,'runs','复核');
    await mkdir(run,{recursive:true}); await mkdir(review,{recursive:true});
    const c=Buffer.from('{"case_id":"case-1"}\n'); const hash=createHash('sha256').update(c).digest('hex');
    const record={run_id:'run-1',product:{product_id:'doubao-work'},task:{case_id:'case-1',case_sha256:hash}};
    await writeFile(path.join(run,'case.json'),c);
    const original=JSON.stringify(record); await writeFile(path.join(run,'run.json'),original); await writeFile(path.join(run,'trace.json'),original);
    const source=path.join(base,'source.txt'), out=path.join(review,'evidence-1');
    await writeFile(source,'test output\n');
    await importEvidence({root:base,runDir:run,source,outputDir:out});
    const evidence=JSON.parse(await readFile(path.join(out,'evidence.json'),'utf8'));
    assert.equal(evidence.source,'operator_exported'); assert.equal(evidence.independently_verified,false); assert.equal(evidence.task_verdict,'not_evaluated');
    assert.equal(await readFile(path.join(out,'operator-evidence.txt'),'utf8'),'test output\n');
    assert.equal(await readFile(path.join(run,'run.json'),'utf8'),original);
    await assert.rejects(importEvidence({root:base,runDir:run,source,outputDir:out}));
    await writeFile(path.join(run,'trace.json'),JSON.stringify({...record,product:{product_id:'workbuddy'}}));
    await assert.rejects(importEvidence({root:base,runDir:run,source,outputDir:path.join(review,'wrong')}),/identity/);
    await writeFile(source,'   ');
    await writeFile(path.join(run,'trace.json'),original);
    await assert.rejects(importEvidence({root:base,runDir:run,source,outputDir:path.join(review,'empty')}),/empty/);
  } finally {
    if(path.dirname(path.resolve(base))!==path.resolve(os.tmpdir()) || !path.basename(base).startsWith('doubao-evidence-test-')) throw Error('unsafe test directory');
    await rm(base,{recursive:true,force:true});
  }
});
