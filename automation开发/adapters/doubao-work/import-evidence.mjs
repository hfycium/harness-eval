import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const within = (base, child) => child === base || child.startsWith(base + path.sep);

export async function importEvidence({runDir, source, outputDir, root = projectRoot}) {
  const rootReal = await realpath(root);
  const runsRoot = await realpath(path.join(rootReal, 'runs', '自动化'));
  const reviewRoot = await realpath(path.join(rootReal, 'runs', '复核'));
  const run = await realpath(runDir);
  if (!within(runsRoot,run) || run === runsRoot) throw Error('run must be inside runs/自动化');
  const output = path.resolve(outputDir);
  const parent = await realpath(path.dirname(output));
  const target = path.join(parent,path.basename(output));
  if (!within(reviewRoot,target) || within(run,target) || within(target,run)) throw Error('output must be a new directory inside runs/复核');
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size < 1 || sourceInfo.size > 1_000_000) throw Error('source must be a non-empty regular file of at most 1 MB');
  const sourceReal = await realpath(source);
  if (within(target,sourceReal)) throw Error('source cannot be inside output');
  const [runBytes, traceBytes, caseBytes, content] = await Promise.all(['run.json','trace.json','case.json'].map(n => readFile(path.join(run,n))).concat(readFile(sourceReal)));
  const [r,t,c] = [runBytes,traceBytes,caseBytes].map(b => JSON.parse(b.toString('utf8')));
  if (r.product?.product_id !== 'doubao-work' || t.product?.product_id !== 'doubao-work' || !r.run_id || r.run_id !== t.run_id || r.task?.case_id !== c.case_id || t.task?.case_id !== c.case_id || r.task?.case_sha256 !== digest(caseBytes) || t.task?.case_sha256 !== digest(caseBytes)) throw Error('run product, identity or case integrity mismatch');
  let text; try { text = new TextDecoder('utf-8', {fatal:true}).decode(content); } catch { throw Error('source must be UTF-8 text'); }
  if (!text.trim()) throw Error('source text is empty');
  const metadata = { record_version:'0.1', imported_at:new Date().toISOString(), run_id:r.run_id, case_id:c.case_id, product_id:'doubao-work', source:'operator_exported', content_origin:'operator_provided_client_display', independently_verified:false, completeness:'unknown', task_verdict:'not_evaluated', evidence_file:'operator-evidence.txt', evidence_sha256:digest(content), evidence_size_bytes:content.length, run_sha256:digest(runBytes), trace_sha256:digest(traceBytes), case_sha256:digest(caseBytes) };
  await mkdir(target);
  await writeFile(path.join(target,'operator-evidence.txt'),content,{flag:'wx'});
  await writeFile(path.join(target,'evidence.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  return {run_id:r.run_id, source:metadata.source, task_verdict:metadata.task_verdict, output_dir:target};
}

async function main() {
  const args=process.argv.slice(2);
  if (args.length !== 6 || !['--run-dir','--source','--output-dir'].every(k => args.includes(k))) throw Error('Usage: node import-evidence.mjs --run-dir <run> --source <UTF-8 text> --output-dir <new review directory>');
  const get=k=>args[args.indexOf(k)+1];
  console.log(JSON.stringify(await importEvidence({runDir:get('--run-dir'),source:get('--source'),outputDir:get('--output-dir')})));
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
