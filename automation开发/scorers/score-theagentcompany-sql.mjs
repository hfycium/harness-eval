import { createHash } from 'node:crypto';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = b => createHash('sha256').update(b).digest('hex');
const within = (base, p) => p === base || p.startsWith(base + path.sep);
const expected = [['Gaming Laptop G1',1799.99],['Professional Laptop T1',1299.99],['Tablet Pro T1',899.99]];
export function grade(contents) {
  const integer = (s, n) => /^[+-]?\d+$/.test(s.trim()) && Number(s.trim()) === n;
  const rows = contents[2].split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => /^"([^"]+)"\s*,\s*([\d.]+)/.exec(s)).filter(Boolean).map(m => [m[1],Number(m[2])]);
  const checks = [integer(contents[0],20),integer(contents[1],3),rows.length === 3 && rows.every((r,i) => r[0] === expected[i][0] && Number.isFinite(r[1]) && Math.abs(r[1]-expected[i][1]) <= 0.01)];
  return checks.map((passed,i)=>({id:`task${i+1}`,passed,earned:passed?i+1:0,maximum:i+1}));
}
export async function evaluate(runDir) {
  const root=await realpath(runDir), names=['run.json','trace.json','case.json'];
  const bytes=await Promise.all(names.map(n=>readFile(path.join(root,n))));
  const [run,trace,task]=bytes.map(b=>JSON.parse(b.toString('utf8')));
  if(task.case_id!=='theagentcompany-ds-sql-exercise'||run.run_id!==trace.run_id||run.task?.case_id!==task.case_id||trace.task?.case_id!==task.case_id||run.task?.case_sha256!==sha(bytes[2])||trace.task?.case_sha256!==sha(bytes[2])) throw Error('run/trace/case 身份或摘要不一致');
  if(run.execution?.status!=='completed'||trace.execution?.status!=='completed') throw Error('运行未完成，评分阻塞');
  if(JSON.stringify(run.artifacts)!==JSON.stringify(trace.artifacts)) throw Error('run 与 trace 产物清单不一致');
  const artifactsRoot=await realpath(path.join(root,'artifacts')), contents=[], evidence={};
  if(!within(root,artifactsRoot)) throw Error('产物目录越界');
  for(let i=1;i<=3;i++) {
    const name=`task${i}.txt`, matches=(run.artifacts??[]).filter(a=>a.path===name&&a.collection_status==='collected');
    if(matches.length!==1||matches[0].evidence_path!==`artifacts/${name}`) throw Error(`${name} 缺失或不唯一`);
    const p=await realpath(path.join(root,matches[0].evidence_path)); if(!within(artifactsRoot,p)) throw Error('产物越界');
    const b=await readFile(p); if(sha(b)!==matches[0].sha256) throw Error(`${name} 摘要不匹配`);
    contents.push(new TextDecoder('utf-8',{fatal:true}).decode(b)); evidence[matches[0].evidence_path]=sha(b);
  }
  const checks=grade(contents), score=checks.reduce((s,c)=>s+c.earned,0);
  return {record_version:'0.1',evaluator:'theagentcompany-sql-independent-0.1',run_id:run.run_id,case_id:task.case_id,archive_status:'passed',task_correctness:checks.every(c=>c.passed)?'passed':'failed',score,maximum:6,checks,benchmark_score:null,source:'https://github.com/TheAgentCompany/TheAgentCompany/blob/main/workspaces/tasks/ds-sql-exercise/evaluator.py',source_revision:'unfrozen',scope:'独立实现，未与固定版本官方评分器核验等价',evidence_hashes:{...Object.fromEntries(names.map((n,i)=>[n,sha(bytes[i])])),...evidence}};
}
async function main() {
  const args=process.argv.slice(2), get=n=>{const i=args.indexOf(n);return i<0?null:args[i+1]};
  if(!get('--run-dir')||!get('--output-dir')) throw Error('需要 --run-dir 和 --output-dir');
  const run=await realpath(get('--run-dir')), out=path.resolve(get('--output-dir')), parent=await realpath(path.dirname(out)), target=path.join(parent,path.basename(out));
  if(within(run,target)||within(target,run)) throw Error('输出必须与运行目录分离');
  let result; try { result=await evaluate(run); } catch(e) { result={record_version:'0.1',archive_status:'blocked',task_correctness:'unknown',benchmark_score:null,reason:e.message}; }
  await mkdir(target); await writeFile(path.join(target,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.task_correctness,output_dir:target})); if(result.archive_status==='blocked') process.exitCode=2;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
