import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { HarnessAdapter } from './base.mjs';

const DEEPSEEK_MESSAGES_BASE_URL = 'https://api.deepseek.com/anthropic';
const CHATANYWHERE_BASE_URL = 'https://api.chatanywhere.tech/v1';
const CHATANYWHERE_MODEL = 'deepseek-v4.1-flash-1017';

function isChatAnywherePatch(config) {
  return typeof config.model_patch === 'string' && config.model_patch.toLowerCase().includes('chatanywhere');
}

function credentialPresent(value) {
  return value === true || (typeof value === 'string' && value.length > 0);
}

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
    const chatAnywhere = isChatAnywherePatch(config);
    return {
      executable: config.executable ?? null,
      profile: config.profile ?? null,
      model_patch: config.model_patch ?? null,
      ...(chatAnywhere ? {
        provider_id: 'chatanywhere', base_url: CHATANYWHERE_BASE_URL,
        wire_api: 'openai-completions', model: config.model ?? CHATANYWHERE_MODEL,
        reasoning_effort: config.reasoning_effort ?? 'high',
        api_key_env: config.api_key_env ?? 'CHATANYWHERE_API_KEY',
        credential_source: environment.CHATANYWHERE_API_KEY_SOURCE ?? 'process_environment',
        credential_present: credentialPresent(environment[config.api_key_env ?? 'CHATANYWHERE_API_KEY']),
      } : {}),
      temp_workspace: config.temp_workspace === true,
      tool_bench_mcp_enabled: config.tool_bench_mcp_enabled === true,
      tool_bench_mcp_url: config.tool_bench_mcp_enabled === true ? (environment.TOOL_BENCH_MCP_URL ?? 'http://127.0.0.1:17123/mcp') : null,
      tool_bench_control_root_configured: config.tool_bench_mcp_enabled === true ? Boolean(environment.HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT) : false,
      tool_bench_expected_tools_sha256: config.tool_bench_mcp_enabled === true ? (environment.TOOL_BENCH_EXPECTED_TOOLS_SHA256 ?? null) : null,
      timeout_seconds: config.timeout_seconds ?? null,
      json_events: config.json_events === true,
      home_source: environment.DSH_HOME ? 'process_environment' : config.home ? 'adapter_config' : 'default',
    };
  }

  modelCondition(config, { environment = {} } = {}) {
    const explicitDeepSeekCondition = config.model_patch === 'automation开发/configs/dsh.deepseek-flash-high.patch.yml';
    const chatAnywhere = isChatAnywherePatch(config);
    return {
      provider_id: chatAnywhere ? 'chatanywhere' : explicitDeepSeekCondition ? 'deepseek-official' : null,
      endpoint_ref: chatAnywhere ? CHATANYWHERE_BASE_URL : explicitDeepSeekCondition ? DEEPSEEK_MESSAGES_BASE_URL : null,
      effective_endpoint_ref: null,
      wire_api: chatAnywhere ? 'openai-completions' : explicitDeepSeekCondition ? 'messages' : null,
      requested_model: chatAnywhere ? (config.model ?? CHATANYWHERE_MODEL) : explicitDeepSeekCondition ? 'deepseek-flash' : null,
      effective_model: null,
      requested_reasoning_effort: chatAnywhere ? (config.reasoning_effort ?? 'high') : explicitDeepSeekCondition ? 'high' : null,
      effective_reasoning_effort: null,
      credential_source: chatAnywhere
        ? environment.CHATANYWHERE_API_KEY_SOURCE ?? (environment.CHATANYWHERE_API_KEY ? 'process_environment' : 'unknown')
        : environment.DEEPSEEK_API_KEY_SOURCE ?? (environment.DEEPSEEK_API_KEY ? 'process_environment' : 'unknown'),
      credential_present: chatAnywhere ? environment[config.api_key_env ?? 'CHATANYWHERE_API_KEY'] ?? null : environment.DEEPSEEK_API_KEY ?? null,
      process_environment_present: chatAnywhere
        ? Boolean(environment[config.api_key_env ?? 'CHATANYWHERE_API_KEY'])
        : Boolean(environment.DEEPSEEK_API_KEY),
      match_status: 'unknown',
      evidence_refs: explicitDeepSeekCondition || chatAnywhere ? [config.model_patch] : [],
    };
  }

  permissionDescription(config) {
    return config.profile ? { profile_ref: config.profile, runtime_enforcement: 'unknown' } : null;
  }

  preflight(config, { profile, timeoutSeconds, environment = process.env }) {
    const missing = [];
    if (!config.executable) missing.push('executable');
    if (!profile) missing.push('profile');
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) missing.push('timeout_seconds');
    if (isChatAnywherePatch(config)) {
      const apiKeyEnv = config.api_key_env ?? 'CHATANYWHERE_API_KEY';
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) missing.push('api_key_env');
      if (!credentialPresent(environment[apiKeyEnv])) missing.push('chatanywhere_api_key');
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
      ? { status: 'not_admitted', missing, reason: 'DSH executable, profile, and positive timeout are required.' }
      : { status: 'ready', missing: [] };
  }

  async buildInvocation(config, context) {
    if (!config.executable) throw new Error('DSH executable is not configured.');
    if (!context.profile) throw new Error('DSH profile is not configured.');
    const args = ['--profile', context.profile];
    if (config.model_patch) {
      args.push('--patch', path.resolve(context.rootDir, config.model_patch));
    }
    if (config.tool_bench_mcp_enabled === true) {
      const controlRoot = process.env.HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT;
      if (!controlRoot || !path.isAbsolute(controlRoot)) throw new Error('HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT must be an absolute path.');
      const bridgeDir = path.resolve(context.rootDir, 'automation开发', 'connectors', 'tool-bench-mcp');
      const endpoint = process.env.TOOL_BENCH_MCP_URL ?? 'http://127.0.0.1:17123/mcp';
      const configPath = path.join(context.workspaceDir, '.mcp.json');
      const mcpConfig = {
        mcpServers: {
          harness_eval_tool_bench_hubspot: {
            type: 'stdio', command: process.execPath,
            args: [path.join(bridgeDir, 'stdio-bridge.mjs')], cwd: bridgeDir,
            env: {
              TOOL_BENCH_MCP_URL: endpoint,
              HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT: controlRoot,
              TOOL_BENCH_TOOLS_SCHEMA_PATH: process.env.TOOL_BENCH_TOOLS_SCHEMA_PATH ?? '',
              TOOL_BENCH_EXPECTED_TOOLS_SHA256: process.env.TOOL_BENCH_EXPECTED_TOOLS_SHA256 ?? '',
            },
          },
        },
      };
      await writeFile(configPath, JSON.stringify(mcpConfig, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
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
        ...(config.model_patch === 'automation开发/configs/dsh.deepseek-flash-high.patch.yml' ? { DEEPSEEK_BASE_URL: DEEPSEEK_MESSAGES_BASE_URL } : {}),
        ...(context.dshHome ? { DSH_HOME: context.dshHome } : {}),
      },
    };
  }
}
