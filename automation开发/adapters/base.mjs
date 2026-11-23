/** Product adapter contract.
 *
 * Product-specific code builds a process invocation or implements a session
 * execution hook (API, GUI, or assisted). The runner owns task staging,
 * lifecycle records, and safe workspace artifact collection.
 */
export class HarnessAdapter {
  constructor(productId) {
    this.productId = productId;
    this.revision = '0.2.0';
  }

  snapshotConfig(config, _context = {}) {
    return { executable: config.executable ?? null };
  }

  permissionDescription(_config) { return null; }

  preflight(_config, _context) {
    throw new Error(`${this.productId} adapter does not implement preflight().`);
  }

  buildInvocation(_config, _context) {
    throw new Error(`${this.productId} adapter does not implement buildInvocation().`);
  }

  /**
   * Optional session-oriented execution hook for API or GUI adapters.
   * Return null to use the legacy process invocation path.
   */
  async runSession(_context) { return null; }

  normalizeObservation({ stdoutRef, stderrRef, processResult, timedOut }) {
    return {
      source: 'launcher_process',
      process_exit_code: processResult.code,
      signal: processResult.signal,
      timed_out: timedOut,
      raw_evidence_refs: [stdoutRef, stderrRef],
      internal_trace_available: false,
    };
  }
}
