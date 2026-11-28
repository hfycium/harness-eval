import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
}

export function canonicalToolsHash(tools) {
  const orderedTools = [...tools].sort((left, right) => String(left.name).localeCompare(String(right.name)));
  return createHash('sha256').update(JSON.stringify(sorted(orderedTools))).digest('hex');
}

function rpc(id, method, params) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

function parseSse(text) {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    try { return JSON.parse(data); } catch { /* Continue to the next event. */ }
  }
  return null;
}

export async function inspectToolBenchEndpoint(url = process.env.TOOL_BENCH_MCP_URL ?? 'http://127.0.0.1:17123/mcp') {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Tool-Bench MCP endpoint must be HTTP on loopback.');
  let sessionId = null;
  let protocolVersion = '2025-11-25';
  let nextId = 1;
  const request = async (method, params) => {
    const id = nextId++;
    const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': protocolVersion };
    if (sessionId) headers['MCP-Session-Id'] = sessionId;
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(rpc(id, method, params)), signal: AbortSignal.timeout(15000) });
    sessionId = response.headers.get('MCP-Session-Id') ?? sessionId;
    protocolVersion = response.headers.get('MCP-Protocol-Version') ?? protocolVersion;
    const body = await response.text();
    if (!response.ok) throw new Error(`MCP endpoint returned HTTP ${response.status}.`);
    if (!body) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const value = contentType.includes('text/event-stream') ? parseSse(body) : JSON.parse(body);
    if (value?.error) throw new Error(`MCP ${method} returned JSON-RPC error ${value.error.code}.`);
    if (value?.id !== id) throw new Error(`MCP ${method} response ID did not match.`);
    return value?.result ?? null;
  };
  const initialized = await request('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'harness-eval-admission-probe', version: '0.1.0' },
  });
  if (!initialized || typeof initialized.protocolVersion !== 'string') throw new Error('MCP initialize response is incomplete.');
  protocolVersion = initialized.protocolVersion;
  await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': protocolVersion, ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    signal: AbortSignal.timeout(10000),
  }).then(response => { if (!response.ok && response.status !== 202) throw new Error(`MCP initialized notification returned HTTP ${response.status}.`); });

  const tools = [];
  let cursor;
  do {
    const result = await request('tools/list', cursor ? { cursor } : {});
    if (!result || !Array.isArray(result.tools)) throw new Error('MCP tools/list response is incomplete.');
    tools.push(...result.tools);
    cursor = result.nextCursor;
  } while (cursor);
  const orderedTools = [...tools].sort((left, right) => String(left.name).localeCompare(String(right.name)));
  return {
    observed_at: new Date().toISOString(),
    endpoint: endpoint.toString(),
    protocol_version: protocolVersion,
    server_info: initialized.serverInfo ?? null,
    tool_count: orderedTools.length,
    tools: orderedTools,
    tools_sha256: canonicalToolsHash(orderedTools),
    hash_method: 'sha256(sorted-tool-array; recursively sorted object keys; tool order by name)',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  inspectToolBenchEndpoint().then(async result => {
    const outputIndex = process.argv.indexOf('--output');
    if (outputIndex >= 0) {
      const output = process.argv[outputIndex + 1];
      if (!output) throw new Error('--output requires a file path.');
      const absolute = path.resolve(output);
      await writeFile(absolute, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      process.stdout.write(`${JSON.stringify({ output: absolute, tool_count: result.tool_count, tools_sha256: result.tools_sha256 })}\n`);
    } else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
