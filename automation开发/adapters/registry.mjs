import { CodexAdapter } from './codex.mjs';
import { DshAdapter } from './dsh.mjs';
import { DoubaoWorkAdapter } from './doubao-work.mjs';
import { WorkBuddyAdapter } from './workbuddy.mjs';
import { YuanbaoWebAdapter } from './yuanbao-web.mjs';

const adapters = new Map([
  ['codex', CodexAdapter],
  ['dsh', DshAdapter],
  ['doubao-work', DoubaoWorkAdapter],
  ['workbuddy', WorkBuddyAdapter],
  ['yuanbao-web', YuanbaoWebAdapter],
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
