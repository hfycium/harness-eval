import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const probeRoot = path.join(root, 'runs', '探针');
const sha = x => createHash('sha256').update(x).digest('hex');
const within = (base, p) => p === base || p.startsWith(base + path.sep);
const asJson = async p => JSON.parse(await readFile(p, 'utf8'));
async function create() {
  await mkdir(probeRoot, {recursive:true});
  const id = `codex-prompt-${randomBytes(8).toString('hex')}`;
  const dir = path.join(probeRoot,id); await mkdir(dir);
  const markers = Array.from({length:3},() => randomBytes(12).toString('hex'));
  const prompt = `Probe start marker: ${markers[0]}\n\nDo not call any tools, read files, inspect the workspace, or access the network. This is a prompt-delivery check.\n\n中间标记：${markers[1]}\n\nReply with exactly the three hexadecimal markers from the beginning, middle and end of this message, in that order, separated by a single ASCII space. Do not add any other characters, formatting or explanation.\n\nProbe end marker: ${markers[2]}\n`;
  const relative = p => path.relative(root,p).replaceAll('\\','/');
  await writeFile(path.join(dir,'prompt.md'),prompt,{flag:'wx'});
  await writeFile(path.join(dir,'input.txt'),'No task input.\n',{flag:'wx'});
  const task = {case_id:id,case_version:'0.1',dataset:'synthetic_prompt_delivery',dataset_task_id:'codex-prompt-delivery',prompt_source:relative(path.join(dir,'prompt.md')),input_source:relative(path.join(dir,'input.txt')),input_destination:'inputs/input.txt',expected_artifacts:[],limits:{timeout_seconds:180},oracle:{status:'probe_only',type:'markers'}};
  await writeFile(path.join(dir,'case.json'),JSON.stringify(task,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(dir,'expected.json'),JSON.stringify({probe_id:id,markers,expected:markers.join(' '),prompt_sha256:sha(Buffer.from(prompt))},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({probe_dir:relative(dir),case:relative(path.join(dir,'case.json'))}));
}
async function verify(probeArg,runArg) {
  const probe = await realpath(path.resolve(root,probeArg)); const run = await realpath(path.resolve(root,runArg));
  if (!within(await realpath(probeRoot),probe) || !within(await realpath(path.join(root,'runs','自动化')),run)) throw Error('probe or run path outside permitted directories');
  const expected = await asJson(path.join(probe,'expected.json'));
  const [r,t,c,log,prompt] = await Promise.all([asJson(path.join(run,'run.json')),asJson(path.join(run,'trace.json')),asJson(path.join(run,'case.json')),readFile(path.join(run,'stdout.log')),readFile(path.join(run,'prompt.md'))]);
  if (r.run_id !== t.run_id || r.task?.case_id !== expected.probe_id || c.case_id !== expected.probe_id || t.product?.product_id !== 'codex' || sha(prompt) !== expected.prompt_sha256 || r.task?.prompt_sha256 !== expected.prompt_sha256 || t.task?.prompt_sha256 !== expected.prompt_sha256) throw Error('run/probe/prompt identity mismatch');
  const recordedLog = t.evidence?.find(x=>x.path==='stdout.log');
  if (!recordedLog || sha(log) !== recordedLog.sha256) throw Error('stdout hash mismatch');
  const events = log.toString('utf8').split(/\r?\n/).filter(Boolean).map((line,i) => ({...JSON.parse(line),line:i+1}));
  const toolEvents = events.filter(e => e.item && !['agent_message','reasoning','error'].includes(e.item.type));
  const final = events.filter(e => e.type==='item.completed' && e.item?.type==='agent_message').at(-1);
  const completed = events.some(e=>e.type==='turn.completed') && r.execution?.status === 'completed';
  const status = !completed || !final ? 'unknown' : toolEvents.length ? 'failed' : final.item.text === expected.expected ? 'passed' : 'failed';
  const result = {record_version:'0.1',probe_id:expected.probe_id,run_id:r.run_id,status,scope:'selected_markers_for_this_run_only', checked_at:new Date().toISOString(),prompt_sha256:sha(prompt),stdout_sha256:sha(log),tool_events:toolEvents.map(e=>({line:e.line,type:e.item.type})),final_message_event:final?`stdout.log:${final.line}`:null,final_message_matches:final ? final.item.text === expected.expected : null,full_prompt_received:'unknown',reason:!completed?'run_incomplete':!final?'final_message_missing':toolEvents.length?'tool_event_observed':final.item.text===expected.expected?'ordered_markers_match':'marker_mismatch'};
  const out=path.join(probe,'verification.json'); await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status,reason:result.reason,output:path.relative(root,out).replaceAll('\\','/'),run_id:r.run_id}));
  if (status!=='passed') process.exitCode=1;
}
const args=process.argv.slice(2);try {if(args[0]==='create') await create(); else if(args[0]==='verify' && args[1] && args[2]) await verify(args[1],args[2]); else throw Error('Usage: node codex-prompt-probe.mjs create | verify <probe-dir> <run-dir>');}catch(e){console.error(e.message);process.exitCode=2;}
