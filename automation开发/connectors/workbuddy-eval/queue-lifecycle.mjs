import { link, mkdir, readFile, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function inside(parent, child) { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
export function safeRunId(runId) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(runId)) throw new Error('invalid_run_id');
  return runId;
}
export async function safeQueueRoot(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('queue_root_must_be_absolute');
  const root = await realpath(value);
  const project = await realpath(projectRoot);
  if (root === path.parse(root).root || inside(root, project) || inside(project, root)) throw new Error('unsafe_queue_root');
  return root;
}
export async function withClaimLock(queueRoot, runId, fn) {
  safeRunId(runId);
  const locks = path.join(queueRoot, 'queue', 'locks');
  await mkdir(locks, { recursive: true });
  const lock = path.join(locks, `claim-${runId}.lock`);
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') return { status: 'locked' }; throw error; }
  try { return await fn(); } finally { await rmdir(lock); }
}
async function exists(file) { try { await readFile(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export async function inspectQueue(queueRoot, runId) {
  const root = await safeQueueRoot(queueRoot);
  const id = safeRunId(runId);
  const result = {};
  for (const state of ['pending', 'claimed', 'results', 'expired']) result[state] = await exists(path.join(root, 'queue', state, `${id}.json`));
  return result;
}
export async function expirePending(queueRoot, runId, expectedTaskHash) {
  const root = await safeQueueRoot(queueRoot);
  const id = safeRunId(runId);
  return withClaimLock(root, id, async () => {
    const states = await inspectQueue(root, id);
    if (states.claimed || states.results) return { status: 'claimed_or_finalized', states };
    if (!states.pending) return { status: states.expired ? 'already_expired' : 'not_found', states };
    if (states.expired) return { status: 'conflict', states };
    const source = path.join(root, 'queue', 'pending', `${id}.json`);
    const record = JSON.parse(await readFile(source, 'utf8'));
    const { task_sha256: storedHash, ...content } = record;
    const actualHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    if (record.run_id !== id || record.status !== 'queued' || !expectedTaskHash || storedHash !== expectedTaskHash || actualHash !== storedHash) return { status: 'record_mismatch', states };
    const dir = path.join(root, 'queue', 'expired');
    await mkdir(dir, { recursive: true });
    await link(source, path.join(dir, `${id}.json`));
    await unlink(source);
    return { status: 'expired', task_sha256: expectedTaskHash };
  });
}
