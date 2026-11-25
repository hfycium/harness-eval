import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = x => createHash('sha256').update(x).digest('hex');
const fixture = /(?:^|[\\/])ok_then_fail\.cmd/i;
const text = x => typeof x === 'string' ? x : null;

// Converts only observed events; it deliberately does not infer log completeness.
export async function normalize({runDir, source, outputDir}) {
  const runRoot = await realpath(runDir);
  const [runBytes, traceBytes, caseBytes] = await Promise.all(['run.json','trace.json','case.json'].map(f=>readFile(path.join(runRoot,f))));
  const run=JSON.parse(runBytes), trace=JSON.parse(traceBytes), task=JSON.parse(caseBytes);
  if (!run.run_id || run.run_id!==trace.run_id || run.product?.product_id!==trace.product?.product_id || run.task?.case_id!==task.case_id || trace.task?.case_id!==task.case_id || digest(caseBytes)!==run.task?.case_sha256 || digest(caseBytes)!==trace.task?.case_sha256) throw Error('run identity or case integrity mismatch');
  const product=run.product.product_id;
  if (!['codex','dsh','workbuddy','doubao-work'].includes(product) || !['tracetrial-e8-cmd','tracetrial-e8-workbuddy-bash'].includes(task.case_id)) throw Error('unsupported product or case');
  const info=await lstat(source); if (!info.isFile() || info.isSymbolicLink() || info.size>20000000) throw Error('invalid source file');
  const sourcePath=await realpath(source), bytes=await readFile(sourcePath), sha=digest(bytes);
  if (['codex','dsh'].includes(product)) {
    const ref=trace.evidence?.find(e=>e.path==='stdout.log');
    if (sourcePath!==await realpath(path.join(runRoot,'stdout.log')) || !ref || ref.sha256!==sha) throw Error('source does not match archived stdout evidence');
  }
  const lines=bytes.toString('utf8').split(/\r?\n/), rows=[];
  for (const [i,line] of lines.entries()) { if(!line.trim()) continue; try { rows.push({line:i+1, value:JSON.parse(line)}); } catch { throw Error(`invalid JSONL at line ${i+1}`); } }
  if (['workbuddy','doubao-work'].includes(product)) {
    const claims=rows.filter(({value:e})=>{ const raw=product==='doubao-work' && e.role==='tool' ? e.content : e.type==='function_call_result' ? e.output?.text : null; if(typeof raw!=='string') return false; try { const o=JSON.parse(raw); return o.run_id===run.run_id && o.status==='claimed'; } catch { return false; } });
    if(claims.length!==1) throw Error('run claim missing or ambiguous');
  }
  const events=[], ids=new Map();
  const add=(type,line,id,tool,data,timestamp=null)=>events.push({schema_version:'0.1',run_id:run.run_id,product_id:product,event_type:type,tool_name:tool??null,call_id:id??null,timestamp:timestamp??null,data,source:{file:sourcePath,sha256:sha,line}});
  const call=(line,id,tool,command,file,timestamp)=>{ if(!id || ids.has(id)) throw Error('missing or duplicate tool call ID'); ids.set(id,{tool,line,command}); add('tool_call',line,id,tool,{command:text(command),file_path:text(file)},timestamp); };
  const result=(line,id,tool,output,status,exitCode,timestamp)=>{ if(!id || !ids.has(id) || ids.get(id).result) throw Error('unpaired or duplicate tool result'); const c=ids.get(id); c.result=true; add('tool_result',line,id,tool ?? c.tool,{output:fixture.test(c.command ?? '') ? text(output) : null,status:text(status),exit_code:Number.isSafeInteger(exitCode)?exitCode:null},timestamp); };
  for(const {line,value:e} of rows) {
    if(product==='codex') {
      const x=e.item;
      if(e.type==='item.started' && x?.type==='command_execution') call(line,x.id,'command_execution',x.command,null,null);
      if(e.type==='item.completed' && x?.type==='command_execution') { if(!ids.has(x.id)) call(line,x.id,'command_execution',x.command,null,null); result(line,x.id,'command_execution',x.aggregated_output,x.status,x.exit_code,null); }
      if(e.type==='item.completed' && x?.type==='agent_message') add('final_response',line,null,null,{text:text(x.text)},null);
    } else if(product==='dsh') {
      if(e.type==='tool_call') call(line,e.callId,e.tool,e.input?.command,e.input?.file_path,null);
      if(e.type==='tool_result') result(line,e.callId,e.tool,e.result,e.status,null,null);
      if(e.type==='final') add('final_response',line,null,null,{text:text(e.text)},null);
    } else if(product==='workbuddy') {
      if(e.type==='function_call') { let a; try { a=JSON.parse(e.arguments); } catch { throw Error('invalid tool arguments'); } call(line,e.callId,e.name,a.command,a.file_path,e.timestamp); }
      if(e.type==='function_call_result') result(line,e.callId,e.name,e.output?.text,e.status,null,e.timestamp);
      if(e.type==='message' && e.role==='assistant' && line===rows.at(-1).line) { const t=e.content?.filter(x=>x.type==='output_text').map(x=>x.text).join(''); if(t) add('final_response',line,null,null,{text:t},e.timestamp); }
    } else {
      if(e.role==='assistant' && Array.isArray(e.tool_calls)) for(const c of e.tool_calls) { const a=c.function?.arguments; if(!a || typeof a!=='object') throw Error('invalid tool arguments'); call(line,c.id,c.function?.name,a.command,a.file_path,null); }
      if(e.role==='tool' && e.tool_call_id) result(line,e.tool_call_id,null,e.content,null,null,null);
      if(e.role==='assistant' && typeof e.content==='string' && !e.tool_calls && line===rows.at(-1).line) add('final_response',line,null,null,{text:e.content},null);
    }
  }
  if([...ids.values()].some(v=>!v.result)) throw Error('tool result missing');
  const output=path.resolve(outputDir), parent=await realpath(path.dirname(output));
  const target=path.join(parent,path.basename(output)), relative=path.relative(runRoot,target);
  if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative))) throw Error('output must not be inside original run');
  const payload=Buffer.from(events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  const manifest={schema_version:'0.1',converter:'normalize-evidence-0.1',run_id:run.run_id,product_id:product,case_id:task.case_id,source_file:sourcePath,source_sha256:sha,source_run_association:['codex','dsh'].includes(product)?'archived_stdout_hash':'unique_claim_in_session',coverage:'unknown',event_count:events.length,events_sha256:digest(payload),missing:['complete_operation_coverage','network_observation'],created_at:new Date().toISOString()};
  await mkdir(target); await writeFile(path.join(target,'evidence-events.jsonl'),payload,{flag:'wx'}); await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}

async function main(){ const a=process.argv.slice(2); if(a.length!==6 || !['--run-dir','--source','--output-dir'].every(k=>a.includes(k))) throw Error('Usage: node normalize-evidence.mjs --run-dir <run> --source <jsonl> --output-dir <new directory>'); const get=k=>a[a.indexOf(k)+1]; console.log(JSON.stringify(await normalize({runDir:get('--run-dir'),source:get('--source'),outputDir:get('--output-dir')}))); }
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
