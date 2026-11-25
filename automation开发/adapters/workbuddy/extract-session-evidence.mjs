import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hash = b => createHash('sha256').update(b).digest('hex');
const within = (base,p) => p === base || p.startsWith(base + path.sep);

export async function extract({source, runId, outputDir, projectRoot=root, outputRoot=null}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(runId)) throw Error('invalid run ID');
  const reviewRoot = await realpath(outputRoot ?? path.join(projectRoot,'runs','复核'));
  const target = path.join(await realpath(path.dirname(path.resolve(outputDir))),path.basename(path.resolve(outputDir)));
  if (!within(reviewRoot,target) || target === reviewRoot) throw Error('output must be a new directory under runs/复核');
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 20_000_000) throw Error('source must be a regular file under 20 MB');
  const data = await readFile(source);
  const lines = data.toString('utf8').split(/\r?\n/); const events=[];
  for (const [i,line] of lines.entries()) { if (!line.trim()) continue; try { events.push({line:i+1,event:JSON.parse(line)}); } catch { throw Error('session JSONL malformed or incomplete'); } }
  const calls=events.filter(({event:e}) => e.type==='function_call' && e.name==='Bash' && typeof e.arguments==='string' && e.arguments.includes(runId));
  if (calls.length!==1) throw Error('matching Bash call is missing or ambiguous');
  const call=calls[0], paired=events.filter(({event:e}) => e.type==='function_call_result' && e.callId===call.event.callId && e.name==='Bash');
  if (paired.length!==1 || paired[0].line <= call.line) throw Error('matching Bash result is missing or ambiguous');
  let args; try { args=JSON.parse(call.event.arguments); } catch { throw Error('tool arguments invalid'); }
  if (typeof args.command!=='string' || !args.command.includes(runId)) throw Error('run ID missing from command');
  const outcome=paired[0].event.output;
  if (!outcome || outcome.type!=='text' || typeof outcome.text!=='string') throw Error('tool result format unsupported');
  const result={record_version:'0.1',run_id:runId,source:'workbuddy_local_session_jsonl',source_ref:await realpath(source),source_sha256:hash(data),session_id:call.event.sessionId ?? null,call_id:call.event.callId,call_line:call.line,result_line:paired[0].line,extracted_at:new Date().toISOString(),command:args.command,tool_status:paired[0].event.status,tool_result:outcome.text,scope:'one matched tool call only; completeness and session format not guaranteed'};
  await mkdir(target);
  const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
  await writeFile(path.join(target,'tool-evidence.json'),bytes,{flag:'wx'});
  console.log(JSON.stringify({run_id:runId,output_dir:target,evidence_sha256:hash(bytes),call_line:call.line,result_line:paired[0].line}));
}

export async function locateSession(projectsDir, runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(runId)) throw Error('invalid run ID');
  const found=[]; let visited=0;
  async function scan(dir, depth) {
    if (depth>6) throw Error('projects path exceeds depth limit');
    for (const entry of await readdir(dir,{withFileTypes:true})) {
      if (++visited>10000) throw Error('projects path exceeds scan limit');
      if (entry.isSymbolicLink()) continue;
      const p=path.join(dir,entry.name);
      if (entry.isDirectory()) await scan(p,depth+1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const info=await lstat(p); if (info.size>20_000_000) continue;
        const raw=await readFile(p,'utf8'); if (!raw.includes(runId)) continue;
        let matched=false; for (const line of raw.split(/\r?\n/)) { if (!line.trim()) continue; try { const e=JSON.parse(line); if(e.type==='function_call' && e.name==='Bash' && typeof e.arguments==='string' && e.arguments.includes(runId)) matched=true; } catch { matched=false; break; } }
        if(matched) found.push(p);
      }
    }
  }
  await scan(await realpath(projectsDir),0);
  if(found.length!==1) throw Error('matching session is missing or ambiguous');
  return found[0];
}

async function main() {
  const a=process.argv.slice(2); if(a.length!==6 || !['--run-id','--output-dir'].every(k=>a.includes(k)) || (a.includes('--session')===a.includes('--projects-dir'))) throw Error('Usage: node extract-session-evidence.mjs (--session <jsonl> | --projects-dir <directory>) --run-id <id> --output-dir <new review directory>');
  const get=k=>a[a.indexOf(k)+1]; const runId=get('--run-id');
  const source=a.includes('--session') ? get('--session') : await locateSession(get('--projects-dir'),runId);
  await extract({source,runId,outputDir:get('--output-dir')});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
