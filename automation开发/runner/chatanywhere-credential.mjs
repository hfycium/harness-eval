import { execFile as execFileCallback, spawn } from 'node:child_process';
import { access, readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const credentialPath = path.join(process.env.LOCALAPPDATA ?? '', 'HarnessEval', 'chatanywhere-api-key.xml');

function runInteractivePowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: false, shell: false, stdio: 'inherit',
    });
    child.once('error', error => reject(new Error(`PowerShell could not start: ${error.code ?? 'spawn_error'}`)));
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Secure credential operation failed with exit code ${code}.`)));
  });
}

export async function manageChatAnywhereCredential(action) {
  if (process.platform !== 'win32') throw new Error('ChatAnywhere DPAPI credential storage is available only on Windows.');
  if (!['set', 'status', 'remove'].includes(action)) throw new Error('Use: credential chatanywhere set|status|remove');
  if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is unavailable for the current Windows user.');

  if (action === 'status') {
    try { await access(credentialPath); console.log('configured'); }
    catch { console.log('missing'); }
    return;
  }
  if (action === 'remove') {
    try { await unlink(credentialPath); console.log('removed'); }
    catch (error) { if (error.code === 'ENOENT') console.log('missing'); else throw new Error(`Credential removal failed: ${error.code ?? 'filesystem_error'}`); }
    return;
  }

  const storeDirectory = path.dirname(credentialPath);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$secureKey = Read-Host '输入 ChatAnywhere API Key' -AsSecureString",
    "if ($secureKey.Length -eq 0) { throw 'API Key 不能为空。' }",
    `$storeDirectory = '${storeDirectory.replaceAll("'", "''")}'`,
    "$storePath = Join-Path $storeDirectory 'chatanywhere-api-key.xml'",
    'New-Item -ItemType Directory -Path $storeDirectory -Force | Out-Null',
    "$credential = [System.Management.Automation.PSCredential]::new('ChatAnywhere', $secureKey)",
    '$credential | Export-Clixml -LiteralPath $storePath -Force',
    "Write-Output 'ChatAnywhere API Key 已使用当前 Windows 用户的 DPAPI 加密保存。'",
  ].join('\n');
  await runInteractivePowerShell(script);
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

async function selectedChatAnywhereMode(args) {
  if (args[0] === 'batch') {
    const planArg = args[args.indexOf('--plan') + 1];
    if (!planArg) return false;
    try {
      const plan = JSON.parse(await readFile(path.resolve(projectRoot, planArg), 'utf8'));
      for (const job of plan.jobs ?? []) {
        const config = JSON.parse(await readFile(path.resolve(projectRoot, job.config), 'utf8'));
        if (config.provider_mode === 'chatanywhere_api' || (typeof config.model_patch === 'string' && config.model_patch.toLowerCase().includes('chatanywhere'))) return true;
      }
    } catch { return false; }
    return false;
  }
  let harness = argValue(args, '--harness');
  const configArg = argValue(args, '--config') ?? argValue(args, '--adapter');
  if (!harness && configArg) {
    try { harness = JSON.parse(await readFile(path.resolve(projectRoot, configArg), 'utf8')).product_id ?? null; }
    catch { return false; }
  }
  if (harness === 'codex') {
    let configPath = configArg ? path.resolve(projectRoot, configArg) : null;
    if (!configPath) {
      const localConfigPath = path.join(projectRoot, 'automation开发', 'configs', 'codex.local.json');
      try { await readFile(localConfigPath, 'utf8'); configPath = localConfigPath; }
      catch { configPath = path.join(projectRoot, 'automation开发', 'configs', 'codex.example.json'); }
    }
    try { return JSON.parse(await readFile(configPath, 'utf8')).provider_mode === 'chatanywhere_api'; }
    catch { return false; }
  }
  if (harness === 'dsh' && configArg) {
    try {
      const config = JSON.parse(await readFile(path.resolve(projectRoot, configArg), 'utf8'));
      return typeof config.model_patch === 'string' && config.model_patch.toLowerCase().includes('chatanywhere');
    } catch { return false; }
  }
  return false;
}

export async function loadChatAnywhereCredentialForRun(args) {
  if (!['run', 'batch'].includes(args[0]) || process.env.CHATANYWHERE_API_KEY) {
    return { loaded: false, source: process.env.CHATANYWHERE_API_KEY ? 'process_environment' : 'none' };
  }
  if (!await selectedChatAnywhereMode(args) || process.platform !== 'win32') return { loaded: false, source: 'none' };

  try {
    const storePathForPowerShell = credentialPath.replaceAll("'", "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$storePath = '${storePathForPowerShell}'`,
      'if (-not (Test-Path -LiteralPath $storePath -PathType Leaf)) { exit 2 }',
      '$credential = Import-Clixml -LiteralPath $storePath',
      '$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)',
      'try {',
      '  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)',
      '  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($key)))',
      '}',
      'finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }',
    ].join('\n');
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, maxBuffer: 64 * 1024, timeout: 5000,
    });
    const encoded = stdout.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { loaded: false, source: 'none' };
    const key = Buffer.from(encoded, 'base64').toString('utf8');
    if (!key) return { loaded: false, source: 'none' };
    process.env.CHATANYWHERE_API_KEY = key;
    process.env.HARNESS_EVAL_CHATANYWHERE_CREDENTIAL_SOURCE = 'windows_dpapi';
    return { loaded: true, source: 'windows_dpapi' };
  } catch {
    return { loaded: false, source: 'none' };
  }
}

export function clearLoadedChatAnywhereCredential(result) {
  if (result?.loaded) {
    delete process.env.CHATANYWHERE_API_KEY;
    delete process.env.HARNESS_EVAL_CHATANYWHERE_CREDENTIAL_SOURCE;
  }
}
