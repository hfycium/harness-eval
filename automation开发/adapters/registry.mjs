import { CodexAdapter } from './codex.mjs';
import { DshAdapter } from './dsh.mjs';
import { WorkBuddyAdapter } from './workbuddy.mjs';

const adapters = new Map([
  ['codex', CodexAdapter],
  ['dsh', DshAdapter],
  ['workbuddy', WorkBuddyAdapter],
]);

export function getAdapter(productId) {
  const Adapter = adapters.get(productId);
  if (!Adapter) {
    const available = [...adapters.keys()].join(', ');
    throw new Error(`No implemented adapter for '${productId}'. Available adapters: ${available}`);
  }
  return new Adapter();
}

export function listAdapters() { return [...adapters.keys()]; }
