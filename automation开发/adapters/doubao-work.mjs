import { HarnessAdapter } from './base.mjs';
import { WorkBuddyQueueAdapter } from './workbuddy-connector-queue.mjs';

const ENTRY_ID = 'doubao-work-connector-queue';
const QUEUE_ADAPTER = new WorkBuddyQueueAdapter({
  productId: 'doubao-work',
  evidenceDir: 'doubao-work-queue',
  taskExecutionProtocol: 'runner_case_prompt_connector_contract_v1',
});

export class DoubaoWorkAdapter extends HarnessAdapter {
  constructor() { super('doubao-work'); }

  snapshotConfig(config) {
    return {
      ...QUEUE_ADAPTER.snapshotConfig(config),
      entry_id: config.entry_id,
      execution_method: 'local_stdio_mcp_connector_queue',
      connector_transport: 'stdio',
      product_client_trigger: 'operator_started',
      internal_trace: 'unavailable',
    };
  }

  permissionDescription() {
    return QUEUE_ADAPTER.permissionDescription();
  }

  preflight(config, { timeoutSeconds }) {
    if (config.entry_id !== ENTRY_ID) {
      return { status: 'not_admitted', missing: ['entry_id'], reason: 'Doubao Work requires the local connector queue entry.' };
    }
    return QUEUE_ADAPTER.preflight(config, { timeoutSeconds });
  }

  buildInvocation() {
    throw new Error('Doubao Work connector execution uses runSession(), not a CLI process invocation.');
  }

  async runSession(context) {
    return QUEUE_ADAPTER.runSession(context);
  }
}
