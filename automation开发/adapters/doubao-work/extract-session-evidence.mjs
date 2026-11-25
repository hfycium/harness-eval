import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

// E8 only: identify the session by its queue claim, then pair the exact tool call by ID.
export async function collectDoubaoEvidence({sessionsDir, runId, outputDir}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(runId)) throw Error('invalid run ID');
  const root = await realpath(sessionsDir), candidates = [];
  let count = 0;
  async function scan(dir, depth) {
    if (depth > 8) throw Error('session scan depth exceeded');
    for (const entry of await readdir(dir, {withFileTypes:true})) {
      if (++count > 20000) throw Error('session scan limit exceeded');
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file, depth + 1);
      else if (entry.isFile() && entry.name === 'trajectory.jsonl') {
        const info = await lstat(file); if (info.size > 20_000_000) continue;
        const bytes = await readFile(file); const raw = bytes.toString('utf8');
        if (!raw.includes(runId)) continue;
        const events = raw.split(/\r?\n/).map((line, i) => { if (!line.trim()) return null; try { return { line:i+1, value:JSON.parse(line) }; } catch { throw Error('incomplete session JSONL'); } }).filter(Boolean);
        const claims = events.filter(e => { if(e.value.role !== 'tool' || typeof e.value.content !== 'string') return false; try { const x=JSON.parse(e.value.content); return x.status === 'claimed' && x.run_id === runId; } catch { return false; } });
        if (claims.length !== 1) continue;
        const calls = events.flatMap(e => (e.value.role === 'assistant' ? e.value.tool_calls ?? [] : []).filter(c => c.function?.name === 'PowerShell' && c.function?.arguments?.command === 'cmd.exe /d /c tools\\ok_then_fail.cmd').map(c => ({line:e.line, call:c})));
        if (calls.length !== 1 || calls[0].line <= claims[0].line) throw Error('fixture calls missing or ambiguous');
        const results = events.filter(e => e.value.role === 'tool' && e.value.tool_call_id === calls[0].call.id && e.line > calls[0].line);
        if (results.length !== 1 || typeof results[0].value.content !== 'string') throw Error('tool result missing or ambiguous');
        candidates.push({file, bytes, claim:claims[0], call:calls[0], result:results[0]});
      }
    }
  }
  await scan(root,0);
  if (candidates.length !== 1) throw Error('matching session missing or ambiguous');
  const x = candidates[0];
  const evidence = {record_version:'0.1', run_id:runId, source:'doubao_work_local_session_jsonl', source_ref:await realpath(x.file), source_sha256:createHash('sha256').update(x.bytes).digest('hex'), claim_line:x.claim.line, call_line:x.call.line, result_line:x.result.line, call_id:x.call.call.id, command:x.call.call.function.arguments.command, tool_result:x.result.value.content, extracted_at:new Date().toISOString(), scope:'E8 matched claim and one tool call; trajectory completeness unknown'};
  await mkdir(outputDir, {recursive:false});
  await writeFile(path.join(outputDir,'tool-evidence.json'), JSON.stringify(evidence,null,2)+'\n', {flag:'wx'});
  return evidence;
}
