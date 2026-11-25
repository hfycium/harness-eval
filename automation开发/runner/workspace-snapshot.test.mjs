import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {workspaceSnapshot,compareSnapshots} from './workspace-snapshot.mjs';

test('snapshots detect file changes and report incomplete limits',async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'eval-snapshot-'));
  try {
    await mkdir(path.join(base,'input')); await writeFile(path.join(base,'input','a.txt'),'before');
    const before=await workspaceSnapshot(base); await writeFile(path.join(base,'input','a.txt'),'after'); await writeFile(path.join(base,'b.txt'),'new');
    const after=await workspaceSnapshot(base), result=compareSnapshots(before,after);
    assert.equal(result.status,'complete'); assert.deepEqual(result.changes.map(x=>[x.path,x.type]),[['b.txt','added'],['input/a.txt','modified']]);
    assert.equal((await workspaceSnapshot(base,{maxBytes:1})).status,'partial');
  } finally { if(path.dirname(base)!==os.tmpdir() || !path.basename(base).startsWith('eval-snapshot-')) throw Error('unsafe cleanup'); await rm(base,{recursive:true,force:true}); }
});
