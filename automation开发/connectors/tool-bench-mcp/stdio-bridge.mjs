#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { canonicalToolsHash } from './endpoint-inspection.mjs';

const MAX_LINE_BYTES = 1024 * 1024;
const MCP_URL = process.env.TOOL_BENCH_MCP_URL ?? 'http://127.0.0.1:17123/mcp';
const CONTROL_ROOT = process.env.HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT;
const TOOLS_SCHEMA_PATH = process.env.TOOL_BENCH_TOOLS_SCHEMA_PATH;
const EXPECTED_TOOLS_SHA256 = process.env.TOOL_BENCH_EXPECTED_TOOLS_SHA256;
const ACTIVE_RUN_FILE = CONTROL_ROOT ? path.join(CONTROL_ROOT, 'active-run.json') : null;
const SECRET_KEY = /(api[_-]?key|authorization|cookie|password|secret|token)/i;
let remoteSessionId = null;
let protocolVersion = '2025-11-25';
let frozenSchema = null;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redact(child);
  return output;
}

function validateEndpoint() {
  const endpoint = new URL(MCP_URL);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('TOOL_BENCH_MCP_URL must use HTTP on a loopback address.');
  }
  if (!CONTROL_ROOT || !path.isAbsolute(CONTROL_ROOT)) {
    throw new Error('HARNESS_EVAL_TOOL_BENCH_CONTROL_ROOT must be an absolute dedicated directory.');
  }
  if (!TOOLS_SCHEMA_PATH || !path.isAbsolute(TOOLS_SCHEMA_PATH)) throw new Error('TOOL_BENCH_TOOLS_SCHEMA_PATH must be an absolute frozen schema file.');
  if (typeof EXPECTED_TOOLS_SHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(EXPECTED_TOOLS_SHA256)) throw new Error('TOOL_BENCH_EXPECTED_TOOLS_SHA256 must be a lowercase SHA-256 digest.');
  return endpoint;
}

async function loadFrozenSchema() {
  const value = JSON.parse(await readFile(TOOLS_SCHEMA_PATH, 'utf8'));
  if (!value || !Array.isArray(value.tools) || typeof value.protocol_version !== 'string' || canonicalToolsHash(value.tools) !== EXPECTED_TOOLS_SHA256) {
    throw new Error('Frozen Tool-Bench MCP schema is invalid or its hash does not match.');
  }
  frozenSchema = value;
  protocolVersion = value.protocol_version;
}

async function activeRun() {
  if (!ACTIVE_RUN_FILE) return null;
  let value;
  try { value = JSON.parse(await readFile(ACTIVE_RUN_FILE, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Tool-Bench active-run state is unreadable.');
  }
  if (!value || typeof value.run_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value.run_id)
      || typeof value.log_file !== 'string' || path.isAbsolute(value.log_file)
      || value.log_file.split(/[\\/]/).some(part => !part || part === '.' || part === '..')
      || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))
      || Date.parse(value.expires_at) <= Date.now()) {
    throw new Error('Tool-Bench active-run state is invalid or expired.');
  }
  return value;
}

async function appendEvidence(run, entry) {
  await mkdir(CONTROL_ROOT, { recursive: true });
  const root = await realpath(CONTROL_ROOT);
  const relative = run?.log_file ?? 'connector-preflight.jsonl';
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Tool-Bench evidence path escapes its control root.');
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify({ timestamp: new Date().toISOString(), run_id: run?.run_id ?? null, source: 'tool_bench_mcp_bridge', ...entry })}\n`, 'utf8');
}

function parseSse(text) {
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    try { return JSON.parse(data); } catch { /* Continue to the next SSE event. */ }
  }
  return null;
}

async function postRemote(message) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': protocolVersion,
  };
  if (remoteSessionId) headers['MCP-Session-Id'] = remoteSessionId;
  const response = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(30000) });
  const sessionHeader = response.headers.get('MCP-Session-Id');
  if (sessionHeader && message.method === 'initialize') remoteSessionId = sessionHeader;
  const versionHeader = response.headers.get('MCP-Protocol-Version');
  if (versionHeader) protocolVersion = versionHeader;
  const body = await response.text();
  if (!response.ok) {
    const failure = new Error(`Tool-Bench MCP returned HTTP ${response.status}.`);
    failure.httpStatus = response.status;
    failure.responseBody = body;
    throw failure;
  }
  if (response.status === 202 || body.length === 0) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) return parseSse(body);
  try { return JSON.parse(body); }
  catch {
    const failure = new Error('Tool-Bench MCP returned an unreadable response.');
    failure.responseBody = body;
    throw failure;
  }
}

async function ensureRemoteSession() {
  if (remoteSessionId) return;
  const initialize = {
    jsonrpc: '2.0', id: `bridge-init-${Date.now()}`, method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'harness-eval-mcp-bridge', version: '0.1.0' } },
  };
  const response = await postRemote(initialize);
  if (!response?.result || response.error) throw new Error('Tool-Bench remote MCP initialize failed.');
  protocolVersion = response.result.protocolVersion ?? protocolVersion;
  await postRemote({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if (message?.id !== undefined) write(rpcError(message.id, -32600, 'Invalid JSON-RPC request.'));
    return;
  }
  if (!['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'ping'].includes(message.method)) {
    if (message.id !== undefined) write(rpcError(message.id, -32601, 'This bridge only forwards MCP initialization, tool discovery, tool calls, and ping.'));
    return;
  }
  let run = null;
  try {
    run = await activeRun();
    if (message.method === 'tools/call' && !run) {
      await appendEvidence(null, {
        method: message.method,
        request: redact(message),
        request_sha256: sha256(JSON.stringify(redact(message))),
        response: { status: 'rejected', reason: 'no_active_run' },
        transport_status: 'blocked',
      });
      write(rpcError(message.id, -32002, 'No active Tool-Bench run is available; tool call rejected.'));
      return;
    }
    let response;
    if (message.method === 'initialize') {
      if (typeof message.params?.protocolVersion !== 'string') throw new Error('MCP initialize request omitted protocolVersion.');
      response = {
        jsonrpc: '2.0', id: message.id,
        result: {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: frozenSchema.server_info ?? { name: 'tool-bench-frozen-schema-bridge', version: '0.1.0' },
        },
      };
    } else if (message.method === 'tools/list') {
      response = { jsonrpc: '2.0', id: message.id, result: { tools: frozenSchema.tools } };
    } else if (message.method === 'notifications/initialized') {
      response = null;
    } else if (message.method === 'ping') {
      response = { jsonrpc: '2.0', id: message.id, result: {} };
    } else {
      await ensureRemoteSession();
      response = await postRemote(message);
    }
    const requestText = JSON.stringify(redact(message));
    const responseText = response === null ? '' : JSON.stringify(redact(response));
    await appendEvidence(run, {
      method: message.method,
      request: redact(message),
      request_sha256: sha256(requestText),
      response: response === null ? null : redact(response),
      response_sha256: sha256(responseText),
      transport_status: 'ok',
    });
    if (message.id !== undefined && response !== null) write(response);
  } catch (error) {
    const responseBody = typeof error.responseBody === 'string' ? error.responseBody : '';
    let forwardedError = null;
    if (responseBody) {
      try {
        const candidate = JSON.parse(responseBody);
        if (candidate?.jsonrpc === '2.0' && candidate.error && candidate.id === message.id) forwardedError = candidate;
      } catch { /* The response body is not a JSON-RPC error envelope. */ }
    }
    await appendEvidence(run, {
      method: message.method,
      request: redact(message),
      request_sha256: sha256(JSON.stringify(redact(message))),
      response_sha256: responseBody ? sha256(responseBody) : null,
      transport_status: 'error',
      error_code: Number.isInteger(error.httpStatus) ? `http_${error.httpStatus}` : error.name === 'TimeoutError' ? 'timeout' : 'connection_error',
    }).catch(() => {});
    if (message.id !== undefined) write(forwardedError ?? rpcError(message.id, -32000, 'Tool-Bench MCP request failed; see the external run evidence.'));
  }
}

try {
  validateEndpoint();
  await loadFrozenSchema();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
let requestQueue = Promise.resolve();
rl.on('line', line => {
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    write(rpcError(null, -32600, 'MCP request exceeds the 1 MiB limit.'));
    return;
  }
  let message;
  try { message = JSON.parse(line); }
  catch {
    write(rpcError(null, -32700, 'Invalid JSON.'));
    return;
  }
  requestQueue = requestQueue.then(() => handle(message)).catch(() => {
    if (message?.id !== undefined) write(rpcError(message.id, -32603, 'Tool-Bench MCP bridge failed.'));
  });
});
