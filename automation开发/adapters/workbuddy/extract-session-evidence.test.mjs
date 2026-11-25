import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extract, locateSession } from './extract-session-evidence.mjs';

test('extracts one matching call and result; refuses ambiguity and overwrite',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'wb-extract-test-'));
  try {
    const review=path.join(dir,'runs','复核'); await mkdir(review,{recursive:true});
    const source=path.join(dir,'session.jsonl'), output=path.join(review,'one'), runId='run-123';
    const call={type:'function_call',name:'Bash',callId:'call-1',sessionId:'session-1',arguments:JSON.stringify({command:'cd /tmp/run-123 && echo ok'})};
    const result={type:'function_call_result',name:'Bash',callId:'call-1',status:'completed',output:{type:'text',text:'ok'}};
    await writeFile(source,[call,result].map(JSON.stringify).join('\n'));
    assert.equal(await locateSession(dir,runId),source);
    await assert.rejects(locateSession(dir,'run-unknown'),/missing or ambiguous/);
    await extract({source,runId,outputDir:output,projectRoot:dir});
    const x=JSON.parse(await readFile(path.join(output,'tool-evidence.json'),'utf8'));
    assert.equal(x.tool_result,'ok'); assert.equal(x.source,'workbuddy_local_session_jsonl');
    await assert.rejects(extract({source,runId,outputDir:output,projectRoot:dir}));
    await writeFile(source,[call,call,result].map(JSON.stringify).join('\n'));
    await assert.rejects(extract({source,runId,outputDir:path.join(review,'ambiguous'),projectRoot:dir}),/ambiguous/);
  } finally {
    if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('wb-extract-test-')) throw Error('unsafe test directory');
    await rm(dir,{recursive:true,force:true});
  }
});
