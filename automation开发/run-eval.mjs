#!/usr/bin/env node
import { main } from './runner/main.mjs';
import { clearLoadedDeepSeekCredential, loadDeepSeekCredentialForRun, manageDeepSeekCredential } from './runner/deepseek-credential.mjs';

const args = process.argv.slice(2);
let credentialContext = { loaded: false, source: process.env.DEEPSEEK_API_KEY ? 'process_environment' : 'none' };

try {
  if (args[0] === 'credential' && args[1] === 'deepseek') {
    await manageDeepSeekCredential(args[2] ?? 'status');
  } else {
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
  delete process.env.HARNESS_EVAL_DEEPSEEK_CREDENTIAL_SOURCE;
}
