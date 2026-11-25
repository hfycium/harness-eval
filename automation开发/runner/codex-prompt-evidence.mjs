import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function captureCodexPromptEvidence({home, runDir, prompt, stdoutPath}) {
  const evidence = { version:'0.2', status:'unknown', reason:'session_not_found', prompt_sha256:sha(Buffer.from(prompt)), thread_id:null, source_file_sha256:null, source_event_line:null, initial_user_text:null, local_context_models:[], effective_model:null, scope:'codex_local_session_record_not_provider_receipt' };
  try {
    const stdout = (await readFile(stdoutPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
    const threads = stdout.filter(e=>e.type==='thread.started' && typeof e.thread_id==='string').map(e=>e.thread_id);
    if (threads.length !== 1 || !/^[a-zA-Z0-9-]{8,100}$/.test(threads[0])) throw Error('thread_id_unavailable');
    evidence.thread_id = threads[0];
    const sessionsRoot = await realpath(path.join(home,'sessions'));
    const homeReal = await realpath(home);
    if (!sessionsRoot.startsWith(homeReal + path.sep)) throw Error('sessions_outside_isolated_home');
    const files = [];
    async function scan(dir, depth) {
      if (depth > 5) throw Error('session_directory_too_deep');
      for (const d of await readdir(dir,{withFileTypes:true})) {
        if (d.isSymbolicLink()) continue;
        const p=path.join(dir,d.name);
        if (d.isDirectory()) await scan(p,depth+1);
        else if (d.isFile() && d.name.includes(evidence.thread_id) && d.name.endsWith('.jsonl')) files.push(p);
      }
    }
    await scan(sessionsRoot,0);
    if (files.length !== 1) throw Error('session_file_not_unique');
    const info=await lstat(files[0]); if (!info.isFile() || info.size > 20_000_000) throw Error('session_file_invalid');
    const bytes=await readFile(files[0]); evidence.source_file_sha256=sha(bytes);
    const lines=bytes.toString('utf8').split(/\r?\n/); const matches=[];
    for (const [i,line] of lines.entries()) {
      if (!line.trim()) continue;
      const e=JSON.parse(line), p=e.payload;
      if (e.type==='turn_context' && typeof p?.model==='string') evidence.local_context_models.push({line:i+1,model:p.model,source:'local_turn_context_not_provider_receipt'});
      if (e.type==='response_item' && p?.type==='message' && p.role==='user' && Array.isArray(p.content)) {
        const text=p.content.filter(x=>x.type==='input_text' && typeof x.text==='string').map(x=>x.text).join('');
        if (text===prompt) matches.push({line:i+1,text});
      }
    }
    if (matches.length!==1) throw Error('exact_user_message_not_unique');
    evidence.source_event_line=matches[0].line;
    evidence.initial_user_text=matches[0].text;
    evidence.status='matched'; evidence.reason='exact_user_message_found_in_local_session';
  } catch (e) { evidence.reason = e.code ?? e.message ?? 'evidence_error'; }
  const target=path.join(runDir,'codex-prompt-evidence.json');
  const output=Buffer.from(JSON.stringify(evidence,null,2)+'\n');
  await writeFile(target,output,{flag:'wx'});
  return {kind:'codex_prompt_evidence',path:'codex-prompt-evidence.json',sha256:sha(output),source:'local_session_extracted_before_cleanup'};
}
