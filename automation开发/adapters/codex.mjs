import { HarnessAdapter } from './base.mjs';
import path from 'node:path';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/';
const CHATANYWHERE_BASE_URL = 'https://api.chatanywhere.tech/v1';
const DEEPSEEK_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro']);
const CHATANYWHERE_MODELS = new Set(['deepseek-v4.1-flash-1017']);
const REASONING_EFFORTS = new Set(['none', 'low', 'high', 'max']);

function quotedConfig(key, value) {
  return `${key}=${JSON.stringify(value)}`;
}

function tomlStringTable(value) {
  return `{${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}=${JSON.stringify(child)}`).join(',')}}`;
}

function credentialPresent(environment, key) {
  const value = environment?.[key];
  return value === true || (typeof value === 'string' && value.length > 0);
}

export class CodexAdapter extends HarnessAdapter {
  constructor() { super('codex'); }

  snapshotConfig(config, context = {}) {
    const providerMode = config.provider_mode ?? 'chatgpt_account';
    const apiKeyEnv = config.api_key_env ?? (providerMode === 'chatanywhere_api' ? 'CHATANYWHERE_API_KEY' : 'DEEPSEEK_API_KEY');
    const env = context.environment ?? process.env;
    return {
      executable: config.executable ?? null,
      temp_workspace: config.temp_workspace === true,
      timeout_seconds: config.timeout_seconds ?? null,
      sandbox: 'workspace-write',
      windows_sandbox_implementation: process.platform === 'win32' ? 'mxc' : null,
      ephemeral: config.capture_prompt_evidence !== true && config.account_session_diagnostic !== true,
      tool_bench_mcp_enabled: config.tool_bench_mcp_enabled === true,
      tool_bench_mcp_url: config.tool_bench_mcp_enabled === true ? (process.env.TOOL_BENCH_MCP_URL ?? 'http://127.0.0.1:17123/mcp') : null,
      tool_bench_control_root_configured: config.tool_bench_mcp_enabled === true ? Boolean(process.env.HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT) : false,
      tool_bench_expected_tools_sha256: config.tool_bench_mcp_enabled === true ? (process.env.TOOL_BENCH_EXPECTED_TOOLS_SHA256 ?? null) : null,
      capture_prompt_evidence: config.capture_prompt_evidence === true,
      account_session_diagnostic: config.account_session_diagnostic === true,
      workspace_snapshot: config.workspace_snapshot === true,
      provider_mode: providerMode,
      ...(providerMode === 'chatgpt_account' ? { requested_model: config.model ?? null, effective_model: null } : {}),
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
      ...(providerMode === 'chatanywhere_api' ? {
        provider_id: 'chatanywhere', base_url: CHATANYWHERE_BASE_URL, wire_api: 'responses',
        model: config.model ?? 'deepseek-v4.1-flash-1017', reasoning_effort: config.reasoning_effort ?? 'high',
        api_key_env: apiKeyEnv,
        credential_source: env.CHATANYWHERE_API_KEY_SOURCE ?? 'process_environment',
        credential_present: credentialPresent(env, apiKeyEnv),
      } : {}),
    };
  }

  modelCondition(config, context = {}) {
    if ((config.provider_mode ?? 'chatgpt_account') !== 'deepseek_api') return {
      ...(config.provider_mode === 'chatanywhere_api' ? {
        provider_id: 'chatanywhere', endpoint_ref: CHATANYWHERE_BASE_URL, wire_api: 'responses',
        requested_model: config.model ?? 'deepseek-v4.1-flash-1017', effective_model: null,
        requested_reasoning_effort: config.reasoning_effort ?? 'high', effective_reasoning_effort: null,
        credential_source: context.environment?.CHATANYWHERE_API_KEY_SOURCE ?? 'process_environment',
        credential_present: credentialPresent(context.environment, config.api_key_env ?? 'CHATANYWHERE_API_KEY'),
        match_status: 'unknown', evidence_refs: [],
      } : {
      provider_id: null, requested_model: config.model ?? null, effective_model: null,
      requested_reasoning_effort: null, effective_reasoning_effort: null,
      match_status: 'unknown', evidence_refs: [],
      }),
    };
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
    if (!['chatgpt_account', 'deepseek_api', 'chatanywhere_api'].includes(providerMode)) missing.push('provider_mode');
    if (providerMode === 'chatgpt_account' && config.model !== undefined && (typeof config.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.model))) missing.push('model');
    if (config.capture_prompt_evidence === true && providerMode !== 'deepseek_api') missing.push('capture_prompt_evidence_requires_isolated_deepseek_home');
    if (config.account_session_diagnostic === true && providerMode !== 'chatgpt_account') missing.push('account_session_diagnostic_requires_chatgpt_account');
    if (providerMode === 'deepseek_api') {
      const model = config.model ?? 'deepseek-flash';
      const effort = config.reasoning_effort ?? 'high';
      const apiKeyEnv = config.api_key_env ?? 'DEEPSEEK_API_KEY';
      if (!DEEPSEEK_MODELS.has(model)) missing.push('model');
      if (!REASONING_EFFORTS.has(effort)) missing.push('reasoning_effort');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) missing.push('api_key_env');
      if (typeof process.env[apiKeyEnv] !== 'string' || process.env[apiKeyEnv].length === 0) missing.push('deepseek_api_key');
    }
    if (providerMode === 'chatanywhere_api') {
      const model = config.model ?? 'deepseek-v4.1-flash-1017';
      const effort = config.reasoning_effort ?? 'high';
      const apiKeyEnv = config.api_key_env ?? 'CHATANYWHERE_API_KEY';
      if (!CHATANYWHERE_MODELS.has(model)) missing.push('model');
      if (!REASONING_EFFORTS.has(effort)) missing.push('reasoning_effort');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) missing.push('api_key_env');
      if (typeof process.env[apiKeyEnv] !== 'string' || process.env[apiKeyEnv].length === 0) missing.push('chatanywhere_api_key');
    }
    if (config.tool_bench_mcp_enabled === true) {
      const controlRoot = process.env.HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT;
      const sshTarget = process.env.TOOL_BENCH_SSH_TARGET;
      const expectedToolsHash = process.env.TOOL_BENCH_EXPECTED_TOOLS_SHA256;
      const toolsSchemaPath = process.env.TOOL_BENCH_TOOLS_SCHEMA_PATH;
      if (!controlRoot || !path.isAbsolute(controlRoot)) missing.push('tool_bench_control_root');
      if (typeof sshTarget !== 'string' || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(sshTarget)) missing.push('tool_bench_ssh_target');
      if (typeof expectedToolsHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedToolsHash)) missing.push('tool_bench_expected_tools_sha256');
      if (typeof toolsSchemaPath !== 'string' || !path.isAbsolute(toolsSchemaPath)) missing.push('tool_bench_tools_schema_path');
      try {
        const endpoint = new URL(process.env.TOOL_BENCH_MCP_URL ?? 'http://127.0.0.1:17123/mcp');
        if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.port !== '17123' || endpoint.pathname !== '/mcp') missing.push('tool_bench_loopback_endpoint');
      } catch { missing.push('tool_bench_loopback_endpoint'); }
    }
    return missing.length
      ? { status: 'not_admitted', missing, reason: providerMode === 'deepseek_api'
        ? 'Codex DeepSeek mode requires the supported provider settings and API key in its named environment variable.'
        : 'Codex CLI and a positive timeout must be configured.' }
      : { status: 'ready', missing: [] };
  }

  buildInvocation(config, { prompt, workspaceDir, codexHomeDir, rootDir }) {
    if (!config.executable) throw new Error('Codex executable is not configured.');
    const args = ['exec'];
    const env = {};
    if ((config.provider_mode ?? 'chatgpt_account') === 'chatgpt_account' && config.model !== undefined) {
      if (typeof config.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.model)) throw new Error('Invalid Codex model name.');
      args.push('--model', config.model);
    }
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
      env.CODEX_HOME = codexHomeDir;
    }
    if (config.provider_mode === 'chatanywhere_api') {
      if (!codexHomeDir) throw new Error('An isolated CODEX_HOME is required for Codex ChatAnywhere mode.');
      const model = config.model ?? 'deepseek-v4.1-flash-1017';
      const effort = config.reasoning_effort ?? 'high';
      const apiKeyEnv = config.api_key_env ?? 'CHATANYWHERE_API_KEY';
      args.push(
        '--strict-config',
        '-c', quotedConfig('model', model),
        '-c', quotedConfig('model_provider', 'chatanywhere'),
        '-c', quotedConfig('model_reasoning_effort', effort),
        '-c', quotedConfig('model_providers.chatanywhere.name', 'ChatAnywhere'),
        '-c', quotedConfig('model_providers.chatanywhere.base_url', CHATANYWHERE_BASE_URL),
        '-c', quotedConfig('model_providers.chatanywhere.wire_api', 'responses'),
        '-c', quotedConfig('model_providers.chatanywhere.env_key', apiKeyEnv),
        '-c', 'model_providers.chatanywhere.requires_openai_auth=false',
      );
      env.CODEX_HOME = codexHomeDir;
    }
    if (config.tool_bench_mcp_enabled === true) {
      const controlRoot = process.env.HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT;
      if (!controlRoot || !path.isAbsolute(controlRoot)) throw new Error('HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT must be an absolute path.');
      const bridgePath = path.resolve(rootDir, 'automation开发', 'connectors', 'tool-bench-mcp', 'stdio-bridge.mjs');
      const endpoint = process.env.TOOL_BENCH_MCP_URL ?? 'http://127.0.0.1:17123/mcp';
      args.push(
        '-c', quotedConfig('mcp_servers.harness_eval_tool_bench.command', 'node'),
        '-c', `mcp_servers.harness_eval_tool_bench.args=[${JSON.stringify(bridgePath)}]`,
        '-c', `mcp_servers.harness_eval_tool_bench.env=${tomlStringTable({ TOOL_BENCH_MCP_URL: endpoint, HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT: controlRoot, TOOL_BENCH_TOOLS_SCHEMA_PATH: process.env.TOOL_BENCH_TOOLS_SCHEMA_PATH ?? '', TOOL_BENCH_EXPECTED_TOOLS_SHA256: process.env.TOOL_BENCH_EXPECTED_TOOLS_SHA256 ?? '' })}`,
      );
    }
    if (process.platform === 'win32') args.push('-c', quotedConfig('windows.sandbox', 'mxc'));
    args.push('--cd', workspaceDir, '--sandbox', 'workspace-write', '--ignore-rules', '--skip-git-repo-check');
    if (config.capture_prompt_evidence !== true && config.account_session_diagnostic !== true) args.push('--ephemeral');
    args.push('--json', '-');
    return {
      executable: config.executable,
      args,
      stdin: prompt,
      cwd: workspaceDir,
      env,
    };
  }
}
