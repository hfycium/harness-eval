import {test} from 'node:test';
import assert from 'node:assert/strict';
import {grade,evaluate} from './score-theagentcompany-sql.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const answers=['20','3','"Gaming Laptop G1", 1799.99\n"Professional Laptop T1", 1299.99\n"Tablet Pro T1", 899.99'];
test('原规则检查数字、顺序、价格及部分分',()=>{
 assert.deepEqual(grade(answers).map(x=>x.earned),[1,2,3]);
 assert.deepEqual(grade(['21','3','bad']).map(x=>x.earned),[0,2,0]);
 assert.equal(grade([answers[0],answers[1],answers[2].split('\n').reverse().join('\n')])[2].passed,false);
});
test('检查归档摘要并阻止篡改产物',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sql-score-'));
 try {
  await mkdir(path.join(dir,'artifacts'));
  const caseBytes=Buffer.from(JSON.stringify({case_id:'theagentcompany-ds-sql-exercise'}));
  const artifacts=[];
  for(let i=1;i<=3;i++){const name=`task${i}.txt`,b=Buffer.from(answers[i-1]);await writeFile(path.join(dir,'artifacts',name),b);artifacts.push({path:name,evidence_path:`artifacts/${name}`,collection_status:'collected',sha256:sha(b)});}
  const record={run_id:'synthetic',task:{case_id:'theagentcompany-ds-sql-exercise',case_sha256:sha(caseBytes)},execution:{status:'completed'},artifacts};
  await writeFile(path.join(dir,'case.json'),caseBytes);await writeFile(path.join(dir,'run.json'),JSON.stringify(record));await writeFile(path.join(dir,'trace.json'),JSON.stringify(record));
  assert.equal((await evaluate(dir)).score,6);
  await writeFile(path.join(dir,'artifacts','task1.txt'),'21');
  await assert.rejects(evaluate(dir),/摘要不匹配/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
