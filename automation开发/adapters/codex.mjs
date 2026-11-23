import { HarnessAdapter } from './base.mjs';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/';
const DEEPSEEK_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro']);
const REASONING_EFFORTS = new Set(['none', 'low', 'high', 'max']);

function quotedConfig(key, value) {
  return `${key}=${JSON.stringify(value)}`;
}

function credentialPresent(environment, key) {
  const value = environment?.[key];
  return value === true || (typeof value === 'string' && value.length > 0);
}

export class CodexAdapter extends HarnessAdapter {
  constructor() { super('codex'); }

  snapshotConfig(config, context = {}) {
    const providerMode = config.provider_mode ?? 'chatgpt_account';
    const apiKeyEnv = config.api_key_env ?? 'DEEPSEEK_API_KEY';
    const env = context.environment ?? process.env;
    return {
      executable: config.executable ?? null,
      temp_workspace: config.temp_workspace === true,
      timeout_seconds: config.timeout_seconds ?? null,
      sandbox: 'workspace-write',
      windows_sandbox_implementation: process.platform === 'win32' ? 'mxc' : null,
      ephemeral: true,
      provider_mode: providerMode,
      ...(providerMode === 'deepseek_api' ? {
        provider_id: 'deepseek',
        base_url: DEEPSEEK_BASE_URL,
        wire_api: 'responses',
        model: config.model ?? 'deepseek-flash',
        reasoning_effort: config.reasoning_effort ?? 'high',
        api_key_env: apiKeyEnv,
        credential_source: env.DEEPSEEK_API_KEY_SOURCE ?? 'process_environment',
        credential_present: credentialPresent(env, apiKeyEnv),
      } : {}),
    };
  }

  modelCondition(config, context = {}) {
    if ((config.provider_mode ?? 'chatgpt_account') !== 'deepseek_api') return null;
    const apiKeyEnv = config.api_key_env ?? 'DEEPSEEK_API_KEY';
    const env = context.environment ?? process.env;
    return {
      provider_id: 'deepseek',
      endpoint_ref: DEEPSEEK_BASE_URL,
      wire_api: 'responses',
      requested_model: config.model ?? 'deepseek-flash',
      effective_model: null,
      requested_reasoning_effort: config.reasoning_effort ?? 'high',
      effective_reasoning_effort: null,
      credential_source: env.DEEPSEEK_API_KEY_SOURCE ?? 'process_environment',
      credential_present: credentialPresent(env, apiKeyEnv),
      match_status: 'unknown',
      evidence_refs: [],
    };
  }

  permissionDescription() {
    return { requested_sandbox: 'workspace-write', runtime_enforcement: 'unverified' };
  }

  preflight(config, { timeoutSeconds }) {
    const missing = [];
    if (!config.executable) missing.push('executable');
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) missing.push('timeout_seconds');
    const providerMode = config.provider_mode ?? 'chatgpt_account';
    if (!['chatgpt_account', 'deepseek_api'].includes(providerMode)) missing.push('provider_mode');
    if (providerMode === 'deepseek_api') {
      const model = config.model ?? 'deepseek-flash';
      const effort = config.reasoning_effort ?? 'high';
      const apiKeyEnv = config.api_key_env ?? 'DEEPSEEK_API_KEY';
      if (!DEEPSEEK_MODELS.has(model)) missing.push('model');
      if (!REASONING_EFFORTS.has(effort)) missing.push('reasoning_effort');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) missing.push('api_key_env');
      if (typeof process.env[apiKeyEnv] !== 'string' || process.env[apiKeyEnv].length === 0) missing.push('deepseek_api_key');
    }
    return missing.length
      ? { status: 'not_admitted', missing, reason: providerMode === 'deepseek_api'
        ? 'Codex DeepSeek mode requires the supported provider settings and API key in its named environment variable.'
        : 'Codex CLI and a positive timeout must be configured.' }
      : { status: 'ready', missing: [] };
  }

  buildInvocation(config, { prompt, workspaceDir, codexHomeDir }) {
    if (!config.executable) throw new Error('Codex executable is not configured.');
    const args = ['exec'];
    const env = {};
    if ((config.provider_mode ?? 'chatgpt_account') === 'deepseek_api') {
      if (!codexHomeDir) throw new Error('An isolated CODEX_HOME is required for Codex DeepSeek mode.');
      const model = config.model ?? 'deepseek-flash';
      const effort = config.reasoning_effort ?? 'high';
      const apiKeyEnv = config.api_key_env ?? 'DEEPSEEK_API_KEY';
      args.push(
        '--strict-config',
        '-c', quotedConfig('model', model),
        '-c', quotedConfig('model_provider', 'deepseek'),
        '-c', quotedConfig('model_reasoning_effort', effort),
        '-c', quotedConfig('model_providers.deepseek.name', 'DeepSeek'),
        '-c', quotedConfig('model_providers.deepseek.base_url', DEEPSEEK_BASE_URL),
        '-c', quotedConfig('model_providers.deepseek.wire_api', 'responses'),
        '-c', quotedConfig('model_providers.deepseek.env_key', apiKeyEnv),
        '-c', 'model_providers.deepseek.requires_openai_auth=false',
      );
      if (process.platform === 'win32') {
        args.push('-c', quotedConfig('windows.sandbox', 'mxc'));
      }
      env.CODEX_HOME = codexHomeDir;
    }
    args.push(
      '--cd', workspaceDir, '--sandbox', 'workspace-write', '--ignore-rules',
      '--skip-git-repo-check', '--ephemeral', '--json', prompt,
    );
    return {
      executable: config.executable,
      args,
      cwd: workspaceDir,
      env,
    };
  }
}
