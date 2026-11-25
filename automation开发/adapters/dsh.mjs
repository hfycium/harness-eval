import path from 'node:path';
import { HarnessAdapter } from './base.mjs';

const DEEPSEEK_MESSAGES_BASE_URL = 'https://api.deepseek.com/anthropic';

function expand(value, context) {
  return String(value)
    .replaceAll('{{prompt}}', context.prompt)
    .replaceAll('{{profile}}', context.profile ?? '')
    .replaceAll('{{run_dir}}', context.runDir)
    .replaceAll('{{workspace_dir}}', context.workspaceDir);
}

export class DshAdapter extends HarnessAdapter {
  constructor() { super('dsh'); }

  snapshotConfig(config, { environment = process.env } = {}) {
    return {
      executable: config.executable ?? null,
      profile: config.profile ?? null,
      model_patch: config.model_patch ?? null,
      temp_workspace: config.temp_workspace === true,
      timeout_seconds: config.timeout_seconds ?? null,
      json_events: config.json_events === true,
      home_source: environment.DSH_HOME ? 'process_environment' : config.home ? 'adapter_config' : 'default',
    };
  }

  modelCondition(config, { environment = {} } = {}) {
    const explicitDeepSeekCondition = config.model_patch === 'automation开发/configs/dsh.deepseek-flash-high.patch.yml';
    return {
      provider_id: explicitDeepSeekCondition ? 'deepseek-official' : null,
      endpoint_ref: explicitDeepSeekCondition ? DEEPSEEK_MESSAGES_BASE_URL : null,
      effective_endpoint_ref: null,
      wire_api: explicitDeepSeekCondition ? 'messages' : null,
      requested_model: explicitDeepSeekCondition ? 'deepseek-flash' : null,
      effective_model: null,
      requested_reasoning_effort: explicitDeepSeekCondition ? 'high' : null,
      effective_reasoning_effort: null,
      credential_source: environment.DEEPSEEK_API_KEY_SOURCE ?? (environment.DEEPSEEK_API_KEY ? 'process_environment' : 'unknown'),
      credential_present: environment.DEEPSEEK_API_KEY ?? null,
      process_environment_present: Boolean(environment.DEEPSEEK_API_KEY),
      match_status: 'unknown',
      evidence_refs: explicitDeepSeekCondition ? [config.model_patch] : [],
    };
  }

  permissionDescription(config) {
    return config.profile ? { profile_ref: config.profile, runtime_enforcement: 'unknown' } : null;
  }

  preflight(config, { profile, timeoutSeconds }) {
    const missing = [];
    if (!config.executable) missing.push('executable');
    if (!profile) missing.push('profile');
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) missing.push('timeout_seconds');
    return missing.length
      ? { status: 'not_admitted', missing, reason: 'DSH executable, profile, and positive timeout are required.' }
      : { status: 'ready', missing: [] };
  }

  buildInvocation(config, context) {
    if (!config.executable) throw new Error('DSH executable is not configured.');
    if (!context.profile) throw new Error('DSH profile is not configured.');
    const args = ['--profile', context.profile];
    if (config.model_patch) {
      args.push('--patch', path.resolve(context.rootDir, config.model_patch));
    }
    if (config.json_events === true) args.push('--json');
    args.push('-');
    return {
      executable: config.executable,
      args: args.map(value => expand(value, context)),
      stdin: context.prompt,
      cwd: config.working_directory === '{{workspace_dir}}'
        ? context.workspaceDir
        : path.resolve(context.rootDir, expand(config.working_directory ?? '{{workspace_dir}}', context)),
      env: {
        DSH_PROFILE: context.profile,
        ...(config.model_patch ? { DEEPSEEK_BASE_URL: DEEPSEEK_MESSAGES_BASE_URL } : {}),
        ...(context.dshHome ? { DSH_HOME: context.dshHome } : {}),
      },
    };
  }
}
