import {createHash} from 'node:crypto';
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';

const sha=b=>createHash('sha256').update(b).digest('hex');
const within=(root,p)=>p===root||p.startsWith(root+path.sep);
async function main(){
  const args=process.argv.slice(2),get=n=>{const i=args.indexOf(n);return i<0?null:args[i+1]};
  if(!get('--run-dir')||!get('--output-dir')) throw Error('需要 --run-dir 和 --output-dir');
  const root=await realpath(get('--run-dir')), out=path.resolve(get('--output-dir')), parent=await realpath(path.dirname(out)),target=path.join(parent,path.basename(out));
  if(within(root,target)||within(target,root)) throw Error('输出必须与运行目录分离');
  const runBytes=await readFile(path.join(root,'run.json')),traceBytes=await readFile(path.join(root,'trace.json')),caseBytes=await readFile(path.join(root,'case.json'));
  const run=JSON.parse(runBytes),trace=JSON.parse(traceBytes),task=JSON.parse(caseBytes);
  if(run.run_id!==trace.run_id||run.task?.case_id!==task.case_id||trace.task?.case_id!==task.case_id||run.task?.case_sha256!==sha(caseBytes)||trace.task?.case_sha256!==sha(caseBytes)) throw Error('运行身份或 case 摘要不一致');
  const refs=[{path:'run.json',sha256:sha(runBytes),status:'observed'},{path:'trace.json',sha256:sha(traceBytes),status:'observed'},{path:'case.json',sha256:sha(caseBytes),status:'observed'}];
  for(const e of run.evidence??[]){
    if(typeof e.path!=='string') continue;
    const p=path.resolve(root,e.path); if(!within(root,p)){refs.push({path:e.path,status:'blocked'});continue;}
    try{const real=await realpath(p);if(!within(root,real))throw Error('outside');const b=await readFile(real),digest=sha(b);refs.push({path:e.path,kind:e.kind??null,source:e.source??null,sha256:digest,status:e.sha256?(e.sha256===digest?'verified':'hash_mismatch'):'hash_unrecorded'});}catch{refs.push({path:e.path,status:'unavailable'});}
  }
  const index={record_version:'0.1',run_id:run.run_id,case_id:task.case_id,product:run.product?.product_id??null,created_at:new Date().toISOString(),evidence:refs,trace_coverage:'unknown',scope:'仅索引 Runner 声明的证据；未解析或采集客户端完整轨迹',missing:run.missing??[]};
  await mkdir(target);await writeFile(path.join(target,'evidence-index.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({run_id:run.run_id,output_dir:target,trace_coverage:'unknown'}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
