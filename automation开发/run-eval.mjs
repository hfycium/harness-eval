#!/usr/bin/env node
import { main } from './runner/main.mjs';
import { clearLoadedDeepSeekCredential, loadDeepSeekCredentialForRun, manageDeepSeekCredential } from './runner/deepseek-credential.mjs';
import { clearLoadedChatAnywhereCredential, loadChatAnywhereCredentialForRun, manageChatAnywhereCredential } from './runner/chatanywhere-credential.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codexModelCommand } from './runner/codex-model-config.mjs';

const args = process.argv.slice(2);
let credentialContext = { loaded: false, source: process.env.DEEPSEEK_API_KEY ? 'process_environment' : 'none' };
let chatAnywhereCredentialContext = { loaded: false, source: process.env.CHATANYWHERE_API_KEY ? 'process_environment' : 'none' };

try {
  if (args[0] === 'batch') {
    chatAnywhereCredentialContext = await loadChatAnywhereCredentialForRun(args);
    process.on('SIGINT', () => {});
    const child = spawn(process.execPath, [fileURLToPath(new URL('./runner/batch.mjs', import.meta.url)), ...args.slice(1)], { stdio: 'inherit', shell: false });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (status, signal) => resolve(signal ? 1 : status)); });
    process.exitCode = code ?? 1;
  } else if (args[0] === 'credential' && args[1] === 'deepseek') {
    await manageDeepSeekCredential(args[2] ?? 'status');
  } else if (args[0] === 'credential' && args[1] === 'chatanywhere') {
    await manageChatAnywhereCredential(args[2] ?? 'status');
  } else if (args[0] === 'codex-model') {
    console.log(JSON.stringify(await codexModelCommand(args[1] ?? 'show', args[2] ?? null)));
  } else {
    chatAnywhereCredentialContext = await loadChatAnywhereCredentialForRun(args);
    credentialContext = await loadDeepSeekCredentialForRun(args);
    if (credentialContext.source !== 'none') {
      process.env.HARNESS_EVAL_DEEPSEEK_CREDENTIAL_SOURCE = credentialContext.source;
    }
    await main();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearLoadedDeepSeekCredential(credentialContext);
  clearLoadedChatAnywhereCredential(chatAnywhereCredentialContext);
  delete process.env.HARNESS_EVAL_DEEPSEEK_CREDENTIAL_SOURCE;
}
