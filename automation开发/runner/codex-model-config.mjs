import { copyFile, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const template=path.join(projectRoot,'automation开发/configs/codex.example.json');
const active=path.join(projectRoot,'automation开发/configs/codex-active.local.json');
const modelPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function codexModelCommand(action='show', model=null) {
  if(action==='show') {
    let config; try { config=JSON.parse(await readFile(active,'utf8')); } catch(e) { if(e.code==='ENOENT') config=JSON.parse(await readFile(template,'utf8')); else throw e; }
    if(config.product_id!=='codex'||config.provider_mode!=='chatgpt_account') throw Error('Active config is not a Codex ChatGPT account configuration.');
    return {config_path:active,model:config.model??null,source:config.model?'local_active_config':'template_default'};
  }
  if(action==='reset') { await rm(active,{force:true}); return {config_path:active,model:null,source:'template_default'}; }
  if(action!=='set'||typeof model!=='string'||!modelPattern.test(model)) throw Error('Usage: codex-model set <model> | show | reset');
  const config=JSON.parse(await readFile(template,'utf8'));
  if(config.product_id!=='codex'||config.provider_mode!=='chatgpt_account') throw Error('Template must use Codex ChatGPT account mode.');
  config.model=model;
  const temp=active+'.tmp-'+process.pid;
  await writeFile(temp,JSON.stringify(config,null,2)+'\n',{flag:'wx'});
  try { await rename(temp,active); } catch(e) { await rm(temp,{force:true}); throw e; }
  return {config_path:active,model,source:'local_active_config'};
}

async function main(){const [action='show',model=null]=process.argv.slice(2);console.log(JSON.stringify(await codexModelCommand(action,model)));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
