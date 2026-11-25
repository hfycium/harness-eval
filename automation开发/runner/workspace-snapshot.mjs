import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function workspaceSnapshot(workspace, {maxEntries=5000, maxBytes=100_000_000}={}) {
  const root=await realpath(workspace), files=[], issues=[]; let entries=0, bytes=0;
  async function scan(dir, depth) {
    if(depth>30) { issues.push({path:path.relative(root,dir),reason:'depth_limit'}); return; }
    let children; try { children=await readdir(dir,{withFileTypes:true}); } catch { issues.push({path:path.relative(root,dir),reason:'read_directory_failed'}); return; }
    children.sort((a,b)=>a.name.localeCompare(b.name));
    for(const child of children) {
      if(++entries>maxEntries) { issues.push({path:'.',reason:'entry_limit'}); return; }
      const full=path.join(dir,child.name), rel=path.relative(root,full).replaceAll('\\','/');
      try {
        const st=await lstat(full);
        if(st.isSymbolicLink()) { issues.push({path:rel,reason:'symbolic_link_not_followed'}); continue; }
        if(st.isDirectory()) { await scan(full,depth+1); continue; }
        if(!st.isFile()) { issues.push({path:rel,reason:'not_regular_file'}); continue; }
        if(bytes+st.size>maxBytes) { issues.push({path:rel,reason:'byte_limit'}); continue; }
        bytes+=st.size; const hash=createHash('sha256'); for await(const chunk of createReadStream(full)) hash.update(chunk);
        const after=await lstat(full); if(!after.isFile() || after.size!==st.size || after.mtimeMs!==st.mtimeMs) { issues.push({path:rel,reason:'changed_during_read'}); continue; }
        files.push({path:rel,size_bytes:st.size,sha256:hash.digest('hex')});
      } catch { issues.push({path:rel,reason:'file_read_failed'}); }
    }
  }
  await scan(root,0);
  return {status:issues.length?'partial':'complete',scope:'workspace_files_at_capture_time_only',files,issues};
}
export function compareSnapshots(before,after) {
  const old=new Map(before.files.map(x=>[x.path,x])), current=new Map(after.files.map(x=>[x.path,x]));
  const paths=[...new Set([...old.keys(),...current.keys()])].sort();
  return {status:before.status==='complete'&&after.status==='complete'?'complete':'partial',scope:'two_point_workspace_snapshot_only',changes:paths.flatMap(p=>{const a=old.get(p),b=current.get(p); const type=!a?'added':!b?'removed':a.sha256!==b.sha256?'modified':null; return type?[{path:p,type,before_sha256:a?.sha256??null,after_sha256:b?.sha256??null}]:[];})};
}
